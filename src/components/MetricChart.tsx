import type { Run } from '../types';

type Props = { runs: Run[]; metric?: keyof Run['metrics']; height?: number };

const colors = ['#b9f35a', '#43d6b4', '#ffbd52', '#7ba4ff'];

export function MetricChart({ runs, metric = 'map50', height = 220 }: Props) {
  const width = 760;
  const padding = 26;
  const maxEpochs = Math.max(1, ...runs.map((run) => run.history.length));
  const valueKey =
    metric === 'map50'
      ? 'metrics/mAP50(B)'
      : metric === 'map5095'
        ? 'metrics/mAP50-95(B)'
        : metric === 'precision'
          ? 'metrics/precision(B)'
          : 'metrics/recall(B)';

  const points = (run: Run) =>
    run.history
      .map((row, index) => {
        const value = Number(row[valueKey] || 0);
        const x = padding + (index / Math.max(1, maxEpochs - 1)) * (width - padding * 2);
        const y = height - padding - value * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div className="metric-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolucao da metrica por epoca">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = height - padding - tick * (height - padding * 2);
          return (
            <g key={tick}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} className="chart-grid" />
              <text x={2} y={y + 4} className="chart-label">{tick.toFixed(2)}</text>
            </g>
          );
        })}
        {runs.map((run, index) => (
          <polyline
            key={run.name}
            points={points(run)}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="chart-legend">
        {runs.map((run, index) => (
          <span key={run.name}>
            <i style={{ background: colors[index % colors.length] }} />{run.name}
          </span>
        ))}
      </div>
    </div>
  );
}
