/**
 * Cópia de segurança DIÁRIA para a nuvem da escola (Google Drive, Backblaze B2, Wasabi, R2, S3…) — parte pura, sem React.
 *   • estado: RPC `school_backup_destination_status()` (administrador; nunca devolve segredos);
 *   • acções: Edge Function `school-backups` (save | test | run-now | disconnect | gdrive-start).
 * Migração 0018 + supabase/functions/school-backups. Detalhes em docs/BACKUP_EXTERNO.md.
 */
export type ExternalProvider = 's3' | 'gdrive';

export interface ExternalRun { at: string; trigger: 'agendado' | 'manual' | 'teste'; ok: boolean; file: string | null; size: number | null; error: string | null }
export interface DestinationStatus {
  configured: boolean;
  provider: ExternalProvider | null;
  enabled: boolean;
  runHour: number;
  retentionDays: number;
  config: { endpoint?: string; region?: string; bucket?: string; prefix?: string; account?: string; folderId?: string | null };
  hasSecret: boolean;
  running: boolean;
  lastAttemptAt: string | null; lastSuccessAt: string | null;
  lastStatus: 'ok' | 'error' | null; lastError: string | null; lastFile: string | null; lastSize: number | null;
  runs: ExternalRun[];
}

export type RpcFn = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message?: string; code?: string } | null }>;
export type InvokeFn = (body: Record<string, unknown>) => Promise<{ data: any; error: string | null }>;

export const RETENTION_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 dias' }, { days: 14, label: '14 dias' }, { days: 30, label: '30 dias (recomendado)' },
  { days: 60, label: '60 dias' }, { days: 90, label: '90 dias' }, { days: 180, label: '6 meses' },
  { days: 365, label: '1 ano' }, { days: 0, label: 'Nunca apagar (cresce sempre)' }
];

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export interface S3Preset { id: string; label: string; endpoint: (region: string) => string; regionHint: string; endpointEditable: boolean; help: string }
export const S3_PRESETS: S3Preset[] = [
  { id: 'b2', label: 'Backblaze B2', endpoint: (r) => `https://s3.${r || 'us-west-004'}.backblazeb2.com`, regionHint: 'us-west-004', endpointEditable: false,
    help: 'No B2: crie um bucket PRIVADO e uma "Application Key" só para ele (leitura, escrita e apagar). A região está no "Endpoint" do bucket (ex.: us-west-004).' },
  { id: 'wasabi', label: 'Wasabi', endpoint: (r) => `https://s3.${r || 'eu-central-1'}.wasabisys.com`, regionHint: 'eu-central-1', endpointEditable: false,
    help: 'No Wasabi: crie um bucket e uma chave de acesso (Access Keys). Use a região do bucket (ex.: eu-central-1).' },
  { id: 'r2', label: 'Cloudflare R2', endpoint: () => 'https://<ID-DA-CONTA>.r2.cloudflarestorage.com', regionHint: 'auto', endpointEditable: true,
    help: 'No R2: crie um bucket e um token S3 com permissão de escrita. O endereço inclui o ID da sua conta Cloudflare. A região é "auto".' },
  { id: 'aws', label: 'Amazon S3', endpoint: (r) => `https://s3.${r || 'eu-west-1'}.amazonaws.com`, regionHint: 'eu-west-1', endpointEditable: false,
    help: 'Na AWS: crie um bucket privado e um utilizador IAM só com acesso a esse bucket (PutObject, ListBucket, DeleteObject).' },
  { id: 'custom', label: 'Outro serviço compatível com S3', endpoint: () => 'https://', regionHint: 'us-east-1', endpointEditable: true,
    help: 'Qualquer serviço com API S3 (DigitalOcean Spaces, Scaleway…). O endereço tem de ser HTTPS e público.' }
];

export function presetForEndpoint(endpoint: string | undefined): S3Preset {
  const e = (endpoint || '').toLowerCase();
  return S3_PRESETS.find((p) =>
    (p.id === 'b2' && e.endsWith('.backblazeb2.com')) || (p.id === 'wasabi' && e.endsWith('.wasabisys.com')) ||
    (p.id === 'r2' && e.endsWith('.r2.cloudflarestorage.com')) || (p.id === 'aws' && e.endsWith('.amazonaws.com'))) ?? S3_PRESETS[S3_PRESETS.length - 1];
}

export const formatSize = (bytes: number | null | undefined): string => {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
};

export function describeTarget(s: Pick<DestinationStatus, 'provider' | 'config'>): string {
  if (s.provider === 'gdrive') return `Google Drive${s.config.account ? ` · ${s.config.account}` : ''}`;
  if (s.provider === 's3') return `${presetForEndpoint(s.config.endpoint).label}${s.config.bucket ? ` · ${s.config.bucket}` : ''}${s.config.prefix ? `/${s.config.prefix}` : ''}`;
  return 'Nenhum destino ligado';
}

export function friendlyExternalError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof (e as any)?.message === 'string' ? (e as any).message : String(e ?? '');
  const code = (e as any)?.code as string | undefined;
  if (code === 'PGRST202' || /Could not find the function/i.test(msg)) return 'A migração 0018 ainda não foi aplicada no Supabase (cópia para a nuvem). Aplique supabase/migrations/0018_external_backup.sql.';
  if (code === '42501' || /Só o administrador/i.test(msg)) return 'Sem permissão: só o administrador da escola gere a cópia para a nuvem.';
  if (/failed to fetch|network|Failed to send a request to the Edge Function/i.test(msg)) return 'Não foi possível contactar o servidor de backups. Verifique a internet e se a função school-backups está publicada.';
  return msg || 'Erro desconhecido.';
}

export function createExternalBackupApi(rpc: RpcFn, invoke: InvokeFn) {
  const act = async (body: Record<string, unknown>) => {
    const { data, error } = await invoke(body);
    if (error) throw new Error(error);
    return data;
  };
  return {
    async status(): Promise<DestinationStatus> {
      const { data, error } = await rpc('school_backup_destination_status');
      if (error) throw Object.assign(new Error(error.message || 'Erro do Supabase'), { code: error.code });
      return data as DestinationStatus;
    },
    save: (a: { provider: ExternalProvider; enabled: boolean; runHour: number; retentionDays: number; config?: Record<string, string>; secret?: { accessKeyId: string; secretAccessKey: string } }) =>
      act({ action: 'save', ...a }),
    test: () => act({ action: 'test' }) as Promise<{ ok: boolean; error?: string }>,
    runNow: () => act({ action: 'run-now' }) as Promise<{ ok: boolean; file?: string; size?: number; deleted?: number; error?: string }>,
    disconnect: () => act({ action: 'disconnect' }),
    async gdriveUrl(returnTo: string): Promise<string> {
      const d = await act({ action: 'gdrive-start', returnTo });
      if (!d?.url) throw new Error('Resposta inesperada do servidor.');
      return String(d.url);
    }
  };
}

/** Como a janela do Google avisa a aplicação (ver main.tsx): BroadcastChannel (+ localStorage de reserva). */
export const DRIVE_CHANNEL = 'bandmed-backup-drive';
export const DRIVE_STORAGE_KEY = 'bandmed:backup-drive-result';
