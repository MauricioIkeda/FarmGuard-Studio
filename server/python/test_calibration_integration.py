import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image


@unittest.skipUnless(os.environ.get('FARMGUARD_CALIBRATION_INTEGRATION') == 'true', 'requires local YOLO weights')
class CalibrationIntegrationTests(unittest.TestCase):
    def test_manual_and_automatic_agree_with_real_yolo_and_all_formats(self):
        farm = Path(os.environ['FARMGUARD_ROOT'])
        canonical = farm / 'Iazinha' / 'Datasets' / 'datasetUnimar' / 'source' / 'traps_events'
        annotation = json.loads(next((canonical / 'annotations').glob('*.json')).read_text())
        scripts = Path(__file__).resolve().parent
        model = farm / 'Iazinha' / 'Models' / 'insect-detector.pt'
        with tempfile.TemporaryDirectory(prefix='farmguard-calibration-') as temp:
            root = Path(temp) / 'DatasetYolo'
            source = Path(temp) / 'source' / 'traps_events' / 'annotations'
            images = root / 'images' / 'val'
            labels = root / 'labels' / 'val'
            for directory in [images, labels, source]:
                directory.mkdir(parents=True)
            width, height = annotation['width'], annotation['height']
            label = '\n'.join(f'0 {(b["x"] + b["width"] / 2) / width:.6f} '
                f'{(b["y"] + b["height"] / 2) / height:.6f} {b["width"] / width:.6f} {b["height"] / height:.6f}'
                for b in annotation['boxes'])
            with Image.open(canonical / 'images' / annotation['image']) as original:
                for i, suffix in enumerate(['.JPEG', '.png', '.webp']):
                    image = f'sample{i}{suffix}'
                    original.convert('RGB').save(images / image)
                    (labels / f'sample{i}.txt').write_text(label)
                    (source / f'sample{i}.json').write_text(json.dumps({**annotation, 'image': image,
                        'ignore_regions': [{'x': 0, 'y': 0, 'width': width, 'height': height}]}))
            common = ['--model', str(model), '--dataset', str(root), '--imgsz', '1280', '--max-det', '1000']
            manual = Path(temp) / 'manual.csv'
            automatic = Path(temp) / 'automatic.csv'
            for script, output, extra in [('manual_calibration.py', manual, ['--confidence', '.33', '--iou', '.17']),
                                           ('precise_calibration.py', automatic, [])]:
                run = subprocess.run([sys.executable, str(scripts / script), *common, '--output', str(output), *extra],
                    capture_output=True, text=True, timeout=180)
                self.assertEqual(run.returncode, 0, run.stdout[-2000:] + run.stderr[-2000:])
            with manual.open() as handle:
                manual_row = next(csv.DictReader(handle))
            with automatic.open() as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 9801)
            automatic_row = next(row for row in rows if float(row['confidence']) == .33 and float(row['nms_iou']) == .17)
            self.assertEqual(manual_row, automatic_row)
            self.assertGreater(int(manual_row['ground_truth']), 0)
            self.assertGreater(int(manual_row['ignored_predictions']), 0)
            print('YOLO real: JPEG/PNG/WebP, 9.801 pares e ajuste manual concordam:', manual_row, flush=True)


if __name__ == '__main__':
    unittest.main()
