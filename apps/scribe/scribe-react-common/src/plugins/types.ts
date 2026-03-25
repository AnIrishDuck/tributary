import type { Extension as MicromarkExtension, HtmlExtension as MicromarkHtmlExtension } from 'micromark-util-types'
import type { Extension as CmExtension } from '@codemirror/state'
import type { ComponentType } from 'react'

export const SCRIBE_PLUGIN_API_VERSION = 1

export interface PluginEntry {
  url: string
  config?: PluginConfig
}

export type PluginConfig = Record<string, string>

export type ScribePluginFactory = (config: PluginConfig) => ScribePlugin

export interface ScribePlugin {
  name: string
  apiVersion: typeof SCRIBE_PLUGIN_API_VERSION

  micromark?: {
    extensions?: MicromarkExtension[]
    htmlExtensions?: MicromarkHtmlExtension[]
  }

  codemirror?: CmExtension[]

  transformHtml?: (html: string) => string

  mounts?: Array<{
    selector: string
    Component: ComponentType<{ element: HTMLElement }>
  }>

  Effect?: ComponentType
}
