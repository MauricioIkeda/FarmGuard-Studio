import hashlib
import json
import math
import os
from pathlib import Path
import sys

import torch
from ultralytics import YOLO


_model = None
_model_key = None


def cached_model(weight, checksum):
    global _model, _model_key
    key = (str(weight.resolve()), checksum)
    if _model_key != key:
        _model = YOLO(str(weight))
        _model_key = key
    return _model


def digest(file):
    with file.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def enhanced_settings(config, checksum):
    profiles = config.get('annotation_profiles', {})
    if not isinstance(profiles, dict):
        raise ValueError('Perfis de anotação inválidos.')
    profile = profiles.get('enhanced')
    if 'enhanced' not in profiles:
        profile = {**config, 'imgsz': 1280, 'augment': True, 'model_sha256': checksum}
    if not isinstance(profile, dict) or profile.get('augment') is not True or str(profile.get('model_sha256', '')).upper() != checksum.upper():
        raise ValueError('O perfil reforçado não corresponde ao modelo principal.')
    size, maximum = profile.get('imgsz'), profile.get('max_det')
    if (isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size)
            or not 640 <= size <= 1920 or size % 32 or isinstance(maximum, bool)
            or not isinstance(maximum, (int, float)) or not math.isfinite(maximum)
            or maximum != int(maximum) or not 1 <= maximum <= 1000):
        raise ValueError('Dimensões ou limite de detecções do perfil reforçado inválidos.')
    for key in ('confidence', 'nms_iou'):
        value = profile.get(key)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not .01 <= value <= .99:
            raise ValueError('Limiares do perfil reforçado inválidos.')
    return {**profile, 'imgsz': int(size), 'max_det': int(maximum)}


def predict_request(request):
    image = Path(request['image']).resolve()
    if not image.is_file():
        raise ValueError('Imagem não encontrada.')
    settings = request['settings']
    root = Path(os.environ.get('FARMGUARD_ROOT') or Path(__file__).resolve().parents[3] / 'FarmGuard')
    weight = root / 'Iazinha/Models/insect-detector.pt'
    config_file = root / 'Iazinha/Models/insect-detector.json'
    config_content = config_file.read_bytes()
    config = json.loads(config_content)
    checksum = digest(weight)
    if checksum.upper() != settings['modelSha256'].upper() or checksum.upper() != config['model_sha256'].upper():
        raise ValueError('O peso mudou antes da análise reforçada. Tente novamente.')
    profile = enhanced_settings(config, checksum)
    if any(settings[key] != profile[field] for key, field in (
        ('imgsz', 'imgsz'), ('confidence', 'confidence'), ('nmsIou', 'nms_iou'), ('maxDet', 'max_det'))):
        raise ValueError('Os parâmetros publicados mudaram antes da análise reforçada. Tente novamente.')
    device = 0 if torch.cuda.is_available() else 'mps' if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available() else 'cpu'
    model = cached_model(weight, checksum)
    try:
        result = model.predict(source=str(image), imgsz=settings['imgsz'], conf=settings['confidence'],
            iou=settings['nmsIou'], max_det=settings['maxDet'], augment=True, rect=True,
            device=device, verbose=False, save=False)[0].cpu()
    finally:
        if device != 'cpu':
            model.to('cpu')
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    if digest(weight) != checksum or config_file.read_bytes() != config_content:
        raise ValueError('O modelo ou seus parâmetros mudaram durante a análise reforçada. Tente novamente.')
    boxes = result.boxes.xyxy.cpu().tolist()
    scores = result.boxes.conf.cpu().tolist()
    return {'model': config['name'], 'width': result.orig_shape[1], 'height': result.orig_shape[0],
        'inference': {'mode': 'enhanced', 'modelSha256': checksum, 'imgsz': settings['imgsz'],
            'confidence': settings['confidence'], 'nmsIou': settings['nmsIou'], 'maxDet': settings['maxDet']},
        'detections': [{'x': box[0], 'y': box[1], 'width': box[2] - box[0], 'height': box[3] - box[1], 'confidence': score}
            for box, score in zip(boxes, scores)]}


def respond(line):
    request = None
    try:
        request = json.loads(line)
        result = predict_request(request)
        response = {'id': request['id'], 'ok': True, 'result': result}
    except Exception as error:
        response = {'id': request.get('id') if isinstance(request, dict) else None, 'ok': False, 'error': str(error)}
    print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    if '--persistent' in sys.argv:
        for line in sys.stdin:
            if line.strip():
                respond(line)
    else:
        respond(sys.stdin.readline())
