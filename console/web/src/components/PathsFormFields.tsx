import { PathPicker } from "./PathPicker";
import { PATH_FIELD_HINTS } from "./PathsHelpPanel";
import { TestButton } from "./TestButton";
import type { TestResult } from "../api";

type PathForm = {
  haConfigRepo: string;
  haBranch: string;
  haStagingConfig: string;
  sidecarData: string;
  mirrorData: string;
};

export function PathsFormFields({
  form,
  onChange,
  showTests,
  onTestGitRepo,
  onTestStagingPath,
}: {
  form: PathForm;
  onChange: (next: PathForm) => void;
  showTests?: boolean;
  onTestGitRepo?: () => Promise<TestResult>;
  onTestStagingPath?: () => Promise<TestResult>;
}) {
  return (
    <>
      <PathPicker
        label="HA config git repo"
        value={form.haConfigRepo}
        onChange={(haConfigRepo) => onChange({ ...form, haConfigRepo })}
        hint={PATH_FIELD_HINTS.haConfigRepo}
      />
      {showTests && onTestGitRepo && <TestButton label="Test git repo" onTest={onTestGitRepo} />}
      <label>
        Git branch
        <input value={form.haBranch} onChange={(e) => onChange({ ...form, haBranch: e.target.value })} />
        <span className="field-hint muted">Branch the kit applies to staging (usually staging)</span>
      </label>
      <PathPicker
        label="Staging HA config directory"
        value={form.haStagingConfig}
        onChange={(haStagingConfig) => onChange({ ...form, haStagingConfig })}
        hint={PATH_FIELD_HINTS.haStagingConfig}
      />
      {showTests && onTestStagingPath && (
        <TestButton label="Test staging config path" onTest={onTestStagingPath} />
      )}
      <PathPicker
        label="Kit data directory"
        value={form.sidecarData}
        onChange={(sidecarData) => onChange({ ...form, sidecarData })}
        hint={PATH_FIELD_HINTS.kitData}
      />
      <PathPicker
        label="Mirror data directory"
        value={form.mirrorData}
        onChange={(mirrorData) => onChange({ ...form, mirrorData })}
        hint={PATH_FIELD_HINTS.mirrorData}
      />
    </>
  );
}
