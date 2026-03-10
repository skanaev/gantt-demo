import { SelectField } from "@admiral-ds/react-ui";
import styled, { createGlobalStyle, css } from "styled-components";

const panelSurface = css`
  border: 1px solid var(--admiral-color-Neutral_Neutral20, #dfe5ef);
  background:
    linear-gradient(
      180deg,
      var(--admiral-color-Neutral_Neutral00, #ffffff) 0%,
      rgba(255, 255, 255, 0.94) 100%
    );
  box-shadow: 0 18px 40px rgba(16, 24, 40, 0.08);
`;

export const GanttChromeStyle = createGlobalStyle`
  .process-tooltip-shell {
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    background: transparent !important;
  }

  .process-tooltip-shell:focus,
  .process-tooltip-shell:focus-visible {
    outline: none !important;
  }
`;

export const Root = styled.section`
  ${panelSurface};
  color: var(--admiral-color-Neutral_Neutral90, #1b1f27);
  border-radius: 24px;
  padding: 20px;
  display: grid;
  gap: 16px;

  @media (max-width: 768px) {
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    padding: 16px 12px;
  }
`;

export const Toolbar = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

export const HeaderBlock = styled.div`
  display: grid;
  gap: 4px;
  min-width: min(100%, 320px);
`;

export const Controls = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
`;

export const ModeField = styled(SelectField)`
  min-width: 180px;
`;

export const LiveToggle = styled.label`
  min-height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--admiral-color-Neutral_Neutral20, #dfe5ef);
  background: var(--admiral-color-Neutral_Neutral00, #ffffff);
  display: inline-flex;
  align-items: center;
  gap: 10px;
`;

export const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
`;

export const MetricCard = styled.div`
  border-radius: 16px;
  border: 1px solid var(--admiral-color-Neutral_Neutral20, #dfe5ef);
  background:
    linear-gradient(
      180deg,
      rgba(242, 245, 250, 0.78) 0%,
      var(--admiral-color-Neutral_Neutral00, #ffffff) 100%
    );
  padding: 12px 14px;
  min-width: 0;
  display: grid;
  gap: 4px;
`;

export const MetricValue = styled.code`
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 16px;
  color: var(--admiral-color-Neutral_Neutral90, #1b1f27);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const StatusRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

export const ChartViewport = styled.div`
  position: relative;
  min-height: 440px;
  height: 500px;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid var(--admiral-color-Neutral_Neutral20, #dfe5ef);
  background:
    linear-gradient(
      180deg,
      rgba(247, 249, 252, 0.92) 0%,
      var(--admiral-color-Neutral_Neutral00, #ffffff) 14%
    );
  --g-arrow-color: var(--admiral-color-Neutral_Neutral60, #7a8599);
  --g-bar-color: #7d8fb3;
  --g-bar-border: transparent;
  --g-tick-color-thick: rgba(111, 120, 138, 0.28);
  --g-tick-color: rgba(111, 120, 138, 0.14);
  --g-actions-background: transparent;
  --g-border-color: rgba(111, 120, 138, 0.12);
  --g-text-muted: var(--admiral-color-Neutral_Neutral50, #7a8599);
  --g-text-light: var(--admiral-color-Neutral_Neutral00, #ffffff);
  --g-text-dark: var(--admiral-color-Neutral_Neutral90, #1b1f27);
  --g-progress-color: rgba(255, 255, 255, 0.28);
  --g-handle-color: var(--admiral-color-Primary_Primary60Main, #2c78ef);
  --g-weekend-label-color: rgba(111, 120, 138, 0.08);
  --g-expected-progress: rgba(198, 211, 242, 0.8);
  --g-header-background: rgba(255, 255, 255, 0.94);
  --g-row-color: rgba(250, 251, 253, 0.94);
  --g-row-border-color: rgba(111, 120, 138, 0.18);
  --g-today-highlight: rgba(44, 120, 239, 0.88);
  --g-popup-actions: transparent;
  --g-weekend-highlight-color: rgba(44, 120, 239, 0.04);

  & .gantt-container {
    font-family: inherit;
    box-sizing: border-box;
    background: transparent;
  }

  & .gantt-container .side-header {
    display: none;
  }

  & .gantt-container .grid-header {
    backdrop-filter: blur(10px);
  }

  & .gantt-container .upper-text {
    font-weight: 600;
  }

  & .gantt .bar-wrapper {
    --stage-bar-track: #d9e0ec;
    --stage-progress-fill: #4fbc84;
    --stage-label-color: #1f2a3d;
    --stage-status-stroke: rgba(66, 84, 110, 0.22);
    outline: none;
  }

  & .gantt .bar-wrapper:focus-visible .bar {
    stroke: var(--admiral-color-Primary_Primary60Main, #2c78ef);
    stroke-width: 2px;
  }

  & .gantt .bar-wrapper .bar {
    fill: var(--stage-bar-track);
    rx: 6px;
    ry: 6px;
    stroke: var(--stage-status-stroke);
    stroke-width: 1px;
    outline: none;
  }

  & .gantt .bar-wrapper .bar-progress {
    fill: var(--stage-progress-fill);
    opacity: 1;
  }

  & .gantt .bar-wrapper.stage-bar--queued .bar {
    --stage-bar-track: #eef2f7;
    --stage-progress-fill: #9aa7ba;
    --stage-label-color: #445267;
    --stage-status-stroke: rgba(122, 135, 156, 0.34);
  }

  & .gantt .bar-wrapper.stage-bar--in-work .bar {
    --stage-bar-track: #edf3fb;
    --stage-progress-fill: #57c58d;
    --stage-label-color: #0d2b5c;
    --stage-status-stroke: rgba(22, 100, 217, 0.42);
  }

  & .gantt .bar-wrapper.stage-bar--completed .bar {
    --stage-bar-track: #e6f4ed;
    --stage-progress-fill: #6ad39b;
    --stage-label-color: #17623c;
    --stage-status-stroke: rgba(46, 173, 110, 0.4);
  }

  & .gantt .bar-wrapper.stage-bar--expired .bar {
    --stage-bar-track: #eef2f7;
    --stage-progress-fill: #57c58d;
    --stage-label-color: #6f1325;
    --stage-status-stroke: rgba(224, 47, 74, 0.88);
  }

  & .gantt .bar-label {
    fill: var(--stage-label-color);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  & .gantt .current-highlight {
    fill: rgba(44, 120, 239, 0.14);
  }

  & .gantt .current-date-highlight {
    stroke: rgba(44, 120, 239, 0.88);
    stroke-width: 2px;
  }

  @media (max-width: 768px) {
    height: 440px;
  }
`;

export const TooltipCard = styled.div<{ $maxHeight?: number }>`
  ${panelSurface};
  width: min(440px, 92vw);
  max-height: ${({ $maxHeight }) => ($maxHeight ? `${$maxHeight}px` : "72vh")};
  overflow: auto;
  border-radius: 18px;
  padding: 14px;
  outline: none;
  display: grid;
  gap: 12px;
`;

export const TooltipHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
`;

export const TooltipTitleBlock = styled.div`
  display: grid;
  gap: 4px;
`;

export const TooltipList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
`;

export const TooltipItem = styled.li`
  border-radius: 14px;
  border: 1px solid var(--admiral-color-Neutral_Neutral20, #dfe5ef);
  background: rgba(247, 249, 252, 0.88);
  padding: 12px;
  display: grid;
  gap: 8px;
`;

export const TooltipItemHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

export const TooltipMeta = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

export const ModalIntro = styled.div`
  display: grid;
  gap: 4px;
`;

export const FormGrid = styled.div`
  display: grid;
  gap: 12px;
  margin-top: 16px;
`;

export const CheckboxRow = styled.label`
  min-height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--admiral-color-Neutral_Neutral20, #dfe5ef);
  background: rgba(247, 249, 252, 0.88);
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const MetaSection = styled.div`
  display: grid;
  gap: 10px;
  margin-top: 20px;
`;

export const MetaList = styled.dl`
  margin: 0;
  display: grid;
  gap: 8px;
`;

export const MetaRow = styled.div`
  display: grid;
  grid-template-columns: 144px 1fr;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(247, 249, 252, 0.88);
  border: 1px solid var(--admiral-color-Neutral_Neutral20, #dfe5ef);

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

export const MetaKey = styled.dt`
  margin: 0;
`;

export const MetaValue = styled.dd`
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
`;

export const MetaHint = styled.div`
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(44, 120, 239, 0.06);
`;
