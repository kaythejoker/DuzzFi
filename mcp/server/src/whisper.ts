// Cliente do serviço Whisper que roda na própria VPS (pasta mcp/whisper)

export interface Audio {
  data: Uint8Array<ArrayBuffer>
  filename: string
  contentType: string
}

export async function transcribe(baseUrl: string, audio: Audio, prompt?: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([audio.data], { type: audio.contentType || 'application/octet-stream' }), audio.filename || 'audio.m4a')
  form.append('language', 'pt')
  if (prompt) form.append('prompt', prompt)
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/transcribe`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`Whisper respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { text?: string }
  return (body.text ?? '').trim()
}
