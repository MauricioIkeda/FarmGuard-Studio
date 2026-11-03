import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch

import suggest_boxes


class SuggestBoxesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='studio-suggestions-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.models = self.root / 'Iazinha/Models'
        self.models.mkdir(parents=True)
        self.weight = self.models / 'insect-detector.pt'
        self.weight.write_bytes(b'fixture weight')
        self.sha = hashlib.sha256(self.weight.read_bytes()).hexdigest()
        self.config_file = self.models / 'insect-detector.json'
        self.config = {'name': 'fixture', 'model_sha256': self.sha, 'imgsz': 1280,
            'confidence': .33, 'nms_iou': .17, 'max_det': 1000}
        self.config_file.write_text(json.dumps(self.config), encoding='utf-8')
        self.image = self.root / 'photo.jpg'
        self.image.write_bytes(b'fixture image')
        self.request = {'id': 'fixture', 'image': str(self.image), 'settings': {
            'modelSha256': self.sha.upper(), 'imgsz': 1280, 'confidence': .33, 'nmsIou': .17, 'maxDet': 1000}}
        self.environment = patch.dict(os.environ, {'FARMGUARD_ROOT': str(self.root)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        suggest_boxes._model = None
        suggest_boxes._model_key = None

    def prediction(self):
        result = SimpleNamespace(orig_shape=(200, 300), boxes=SimpleNamespace(
            xyxy=torch.tensor([[10., 20., 30., 50.]]), conf=torch.tensor([.8])))
        result.cpu = lambda: result
        return [result]

    def test_enhanced_uses_exact_profile_and_preserves_files(self):
        before = self.config_file.read_bytes(), self.weight.read_bytes(), self.image.read_bytes()
        with patch.object(suggest_boxes, 'YOLO') as model:
            model.return_value.predict.return_value = self.prediction()
            result = suggest_boxes.predict_request(self.request)
            arguments = model.return_value.predict.call_args.kwargs
        self.assertTrue(arguments['augment'])
        self.assertTrue(arguments['rect'])
        self.assertEqual((arguments['imgsz'], arguments['conf'], arguments['iou'], arguments['max_det']), (1280, .33, .17, 1000))
        self.assertFalse(arguments['save'])
        self.assertEqual(result['inference']['mode'], 'enhanced')
        self.assertEqual(result['inference']['modelSha256'], self.sha)
        self.assertEqual((result['width'], result['height']), (300, 200))
        self.assertEqual(result['detections'][0]['width'], 20)
        self.assertEqual(result['detections'][0]['height'], 30)
        self.assertEqual(before, (self.config_file.read_bytes(), self.weight.read_bytes(), self.image.read_bytes()))

    def test_rejects_changed_weight_before_loading_model(self):
        self.weight.write_bytes(b'replaced weight')
        with patch.object(suggest_boxes, 'YOLO') as model:
            with self.assertRaisesRegex(ValueError, 'peso mudou'):
                suggest_boxes.predict_request(self.request)
            model.assert_not_called()

    def test_reuses_loaded_weight_and_releases_gpu_between_requests(self):
        with patch.object(suggest_boxes, 'YOLO') as model, patch.object(torch.cuda, 'is_available', return_value=True), \
                patch.object(torch.cuda, 'empty_cache') as release:
            model.return_value.predict.return_value = self.prediction()
            first = suggest_boxes.predict_request(self.request)
            second = suggest_boxes.predict_request(self.request)
            self.assertEqual(first, second)
            model.assert_called_once()
            self.assertEqual(model.return_value.to.call_count, 2)
            model.return_value.to.assert_called_with('cpu')
            self.assertEqual(release.call_count, 2)

    def test_rejects_changed_published_thresholds(self):
        self.config_file.write_text(json.dumps({**self.config, 'confidence': .8}), encoding='utf-8')
        with patch.object(suggest_boxes, 'YOLO') as model:
            with self.assertRaisesRegex(ValueError, 'parâmetros publicados'):
                suggest_boxes.predict_request(self.request)
            model.assert_not_called()

    def test_rejects_model_promotion_during_prediction(self):
        def predict(**kwargs):
            self.config_file.write_text(json.dumps({**self.config, 'name': 'new model'}), encoding='utf-8')
            return self.prediction()
        with patch.object(suggest_boxes, 'YOLO') as model:
            model.return_value.predict.side_effect = predict
            with self.assertRaisesRegex(ValueError, 'mudaram durante'):
                suggest_boxes.predict_request(self.request)

    def test_enhanced_uses_validated_profile_without_changing_standard_settings(self):
        profile = {'model_sha256': self.sha, 'imgsz': 1600, 'confidence': .25, 'nms_iou': .4, 'max_det': 1000, 'augment': True}
        self.config_file.write_text(json.dumps({**self.config, 'annotation_profiles': {'enhanced': profile}}), encoding='utf-8')
        self.request['settings'].update(imgsz=1600, confidence=.25, nmsIou=.4)
        with patch.object(suggest_boxes, 'YOLO') as model:
            model.return_value.predict.return_value = self.prediction()
            result = suggest_boxes.predict_request(self.request)
            arguments = model.return_value.predict.call_args.kwargs
        self.assertEqual((arguments['imgsz'], arguments['conf'], arguments['iou']), (1600, .25, .4))
        self.assertEqual(result['inference']['imgsz'], 1600)
        self.assertEqual(json.loads(self.config_file.read_text())['confidence'], .33)

    def test_rejects_enhanced_profile_from_another_weight(self):
        profile = {'model_sha256': 'other', 'imgsz': 1600, 'confidence': .25, 'nms_iou': .4, 'max_det': 1000, 'augment': True}
        self.config_file.write_text(json.dumps({**self.config, 'annotation_profiles': {'enhanced': profile}}), encoding='utf-8')
        with patch.object(suggest_boxes, 'YOLO') as model:
            with self.assertRaisesRegex(ValueError, 'perfil reforçado'):
                suggest_boxes.predict_request(self.request)
            model.assert_not_called()

    def test_rejects_invalid_profile_container(self):
        for invalid in (None, [], 'invalid', {'enhanced': None}):
            self.config_file.write_text(json.dumps({**self.config, 'annotation_profiles': invalid}), encoding='utf-8')
            with patch.object(suggest_boxes, 'YOLO') as model:
                with self.assertRaises(ValueError):
                    suggest_boxes.predict_request(self.request)
                model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
