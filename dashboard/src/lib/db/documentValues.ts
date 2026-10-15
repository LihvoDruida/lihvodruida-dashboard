import 'server-only';
export {FieldPath,FieldValue,Timestamp} from './documentStore';
export type {PgTransaction as Transaction,PgDocumentSnapshot as QueryDocumentSnapshot} from './documentStore';
import {hasPostgresConfig} from './pgPool';
export const documentStoreKind=(): 'postgres'|'unconfigured'=>hasPostgresConfig()?'postgres':'unconfigured';
