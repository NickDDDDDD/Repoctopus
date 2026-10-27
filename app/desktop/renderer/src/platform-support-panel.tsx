import {
  DESKTOP_PLATFORM_SUPPORT_MATRIX,
  type DesktopSupportStatus,
} from '../../../../domains/desktop/platform-support.js';

const STATUS_LABELS: Record<DesktopSupportStatus, string> = {
  supported: '正式支持',
  experimental: '实验性',
  unsupported: '不支持',
};

export function DesktopPlatformSupportPanel() {
  return (
    <section className="platform-support" aria-labelledby="platform-support-title">
      <div className="section-heading">
        <h2 id="platform-support-title">Platform support</h2>
        <span>Authoritative matrix</span>
      </div>
      <ul aria-label="Desktop platform support matrix">
        {DESKTOP_PLATFORM_SUPPORT_MATRIX.map((target) => (
          <li key={target.id} data-support-status={target.status}>
            <span>
              <strong>{target.label}</strong>
              <small>{target.note}</small>
            </span>
            <span className="support-status">
              {STATUS_LABELS[target.status]} · {target.status}
            </span>
          </li>
        ))}
      </ul>
      <p>能够编译或打包不等于正式支持；只有完整验证过的目标才标记 supported。</p>
    </section>
  );
}
