import { PELPPalDatabase } from './database';
import { LocalRepository } from './repository';

let repository: LocalRepository | undefined;

export function getBrowserRepository(): LocalRepository {
  if (!repository) repository = new LocalRepository(new PELPPalDatabase());
  return repository;
}
