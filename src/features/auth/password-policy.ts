export function minimumPasswordLength(role: string): number {
  return role === 'admin' ? 12 : 10;
}

export function isValidPassword(password: string, role: string): boolean {
  return password.length >= minimumPasswordLength(role) && password.length <= 128;
}

export function passwordLengthMessage(passwordLabel: string, role: string): string {
  return `${passwordLabel} must be between ${minimumPasswordLength(role)} and 128 characters.`;
}
