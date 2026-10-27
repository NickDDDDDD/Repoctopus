export type DesktopSupportStatus = 'supported' | 'experimental' | 'unsupported';

export interface DesktopPlatformSupport {
  readonly id: string;
  readonly platform: string;
  readonly architecture: string;
  readonly label: string;
  readonly status: DesktopSupportStatus;
  readonly packageTarget: string | null;
  readonly note: string;
}

/**
 * The public support contract. A target belongs here only when docs, CLI, UI,
 * packaging and end-to-end verification can all make the same claim.
 */
export const DESKTOP_PLATFORM_SUPPORT_MATRIX: readonly DesktopPlatformSupport[] = [
  {
    id: 'windows-x64',
    platform: 'win32',
    architecture: 'x64',
    label: 'Windows 10/11 x64',
    status: 'supported',
    packageTarget: 'nsis-x64',
    note: '正式支持；安装、启动、单实例、托盘、OTLP 与卸载均经过端到端验证。',
  },
  {
    id: 'windows-arm64',
    platform: 'win32',
    architecture: 'arm64',
    label: 'Windows ARM64',
    status: 'unsupported',
    packageTarget: null,
    note: '尚无 ARM64 安装产物与端到端验证。',
  },
  {
    id: 'macos-x64',
    platform: 'darwin',
    architecture: 'x64',
    label: 'macOS x64',
    status: 'unsupported',
    packageTarget: null,
    note: '尚未实现 macOS Shell、分发与端到端验证。',
  },
  {
    id: 'macos-arm64',
    platform: 'darwin',
    architecture: 'arm64',
    label: 'macOS ARM64',
    status: 'unsupported',
    packageTarget: null,
    note: '尚未实现 macOS Shell、分发与端到端验证。',
  },
  {
    id: 'linux-x64',
    platform: 'linux',
    architecture: 'x64',
    label: 'Linux x64',
    status: 'unsupported',
    packageTarget: null,
    note: '尚未实现 Linux Shell、分发与端到端验证。',
  },
  {
    id: 'linux-arm64',
    platform: 'linux',
    architecture: 'arm64',
    label: 'Linux ARM64',
    status: 'unsupported',
    packageTarget: null,
    note: '尚未实现 Linux Shell、分发与端到端验证。',
  },
];

export function desktopPlatformSupport(
  platform: string,
  architecture: string,
): DesktopPlatformSupport {
  const known = DESKTOP_PLATFORM_SUPPORT_MATRIX.find(
    (target) => target.platform === platform && target.architecture === architecture,
  );
  return (
    known ?? {
      id: `${platform}-${architecture}`,
      platform,
      architecture,
      label: `${platform} ${architecture}`,
      status: 'unsupported',
      packageTarget: null,
      note: '该平台与架构不在 Repoctopus Desktop 的公开支持矩阵中。',
    }
  );
}
