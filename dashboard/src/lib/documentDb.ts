import {hasPostgresConfig} from '@/lib/db/pgPool';
import {getPgDocumentStore} from '@/lib/db/documentStore';
/** PostgreSQL is the only runtime store. No external-store fallback. */
export const hasDocumentDbConfig=()=>hasPostgresConfig();
export const documentStoreMode=(): 'postgres'|'unconfigured'=>hasPostgresConfig()?'postgres':'unconfigured';
export function getDocumentDb(){
 if(!hasPostgresConfig())throw new Error('PostgreSQL is required: set DATABASE_URL.');
 return getPgDocumentStore();
}
