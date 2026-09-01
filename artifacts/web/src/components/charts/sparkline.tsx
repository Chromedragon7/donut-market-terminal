import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

export function Sparkline({ data }: { data: number[] }) {
  const { theme } = useTheme();
  
  const options = {
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { type: 'category', show: false, data: data.map((_, i) => i) },
    yAxis: { type: 'value', show: false, min: 'dataMin', max: 'dataMax' },
    series: [
      {
        data,
        type: 'line',
        showSymbol: false,
        lineStyle: {
          width: 2,
          color: theme === 'dark' ? '#3b82f6' : '#2563eb'
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: theme === 'dark' ? 'rgba(59, 130, 246, 0.4)' : 'rgba(37, 99, 235, 0.2)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0)' }
            ]
          }
        }
      }
    ],
    tooltip: { show: false }
  };

  return <ReactECharts option={options} style={{ height: '100%', width: '100%' }} />;
}
