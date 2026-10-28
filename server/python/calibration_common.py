import os
from pathlib import Path
import sys

farm_root = Path(os.environ.get("FARMGUARD_ROOT", str(Path(__file__).resolve().parents[3] / "FarmGuard")))
sys.path.insert(0, str(farm_root / "Iazinha" / "Training"))
from calibration_metrics import metric_row, sample_truth, threshold_counts, validation_samples
