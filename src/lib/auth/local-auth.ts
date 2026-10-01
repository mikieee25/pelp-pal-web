import { argon2id } from 'hash-wasm';

type ParsedHash = {
  version: number;
  memory: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
  digest: Uint8Array;
};

export async function verifyFlutterArgon2id(password: string, encodedHash: string): Promise<boolean> {
  try {
    const parsed = parseHash(encodedHash);
    if (parsed.version !== 19) return false;
    const derived = await argon2id({
      password,
      salt: parsed.salt,
      parallelism: parsed.parallelism,
      memorySize: parsed.memory,
      iterations: parsed.iterations,
      hashLength: parsed.digest.length,
      outputType: 'binary',
    });
    return constantTimeEqual(derived, parsed.digest);
  } catch {
    return false;
  }
}

function parseHash(encoded: string): ParsedHash {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'argon2id') {
    throw new TypeError('Malformed Argon2id hash.');
  }
  const version = parseParameter(parts[2], 'v');
  const parameters = parts[3].split(',');
  if (parameters.length !== 3) throw new TypeError('Malformed Argon2id parameters.');
  const salt = decodeBase64Url(parts[4]);
  const digest = decodeBase64Url(parts[5]);
  if (salt.length < 16 || digest.length < 16) throw new TypeError('Argon2id values are too short.');
  return {
    version,
    memory: parseParameter(parameters[0], 'm'),
    iterations: parseParameter(parameters[1], 't'),
    parallelism: parseParameter(parameters[2], 'p'),
    salt,
    digest,
  };
}

function parseParameter(value: string, name: string): number {
  const prefix = `${name}=`;
  if (!value.startsWith(prefix)) throw new TypeError('Malformed Argon2id parameter.');
  const parsed = Number(value.slice(prefix.length));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError('Invalid Argon2id parameter.');
  return parsed;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
