/** Select Electron's Node mode for the private Desktop Host child. */
export function desktopNodeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
  };
}
