export type EnrollmentRequest = {
  code: string;
  installation_id: string;
  platform: 'web';
  app_version: string;
};

export function buildEnrollmentRequest(
  code: string,
  installationId: string,
  appVersion: string,
): EnrollmentRequest {
  const normalizedCode = code.trim();
  if (!normalizedCode) throw new Error('Enrollment code is required.');
  if (!installationId.trim()) throw new Error('Installation ID is required.');
  if (!appVersion.trim()) throw new Error('Application version is required.');
  return {
    code: normalizedCode,
    installation_id: installationId.trim(),
    platform: 'web',
    app_version: appVersion.trim(),
  };
}
