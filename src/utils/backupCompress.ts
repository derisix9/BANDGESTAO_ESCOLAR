/**
 * Compactar backups em .zip (DEFLATE). O JSON de uma escola grande (fotos em base64, milhares de registos) comprime
 * tipicamente 5–10×, o que poupa espaço e acelera o descarregamento/envio.
 * O ficheiro de dentro mantém o nome e a extensão originais (ex.: bandmed_escola_antes-do-restauro_2026-10-23_1010.json),
 * por isso o "Carregar" lê o .zip tal como qualquer outro backup (ver readBackupSources em backupImport.ts).
 */
export type ZipCtor = new () => { file(name: string, data: string | Uint8Array): unknown; generateAsync(opts: any): Promise<any> };
export type ZipCtorLoader = () => Promise<ZipCtor>;

const defaultLoader: ZipCtorLoader = async () => (await import('jszip')).default as unknown as ZipCtor;

/** `bandmed_x_2026-10-23_1010.json` → `bandmed_x_2026-10-23_1010.zip`. */
export function zipFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '') + '.zip';
}

/** Compacta UM ficheiro num .zip e devolve os bytes. */
export async function zipBackupFile(innerName: string, data: string | Uint8Array, load: ZipCtorLoader = defaultLoader): Promise<Uint8Array> {
  const Zip = await load();
  const zip = new Zip();
  zip.file(innerName, data);
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (!out || !out.length) throw new Error('Não foi possível gerar o ficheiro ZIP do backup.');
  return out as Uint8Array;
}
