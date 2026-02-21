import { TributaryStream } from 'tributary-client'
import { ensureMigrations } from './migrations.js'
import { createCollection } from './collection.js'

export async function initializeLibrary(stream: TributaryStream, name: string): Promise<void> {
  await ensureMigrations(stream, true)
  await createCollection(stream, { title: name, inserter: 'user' })
}
