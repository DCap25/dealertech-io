export * from './types'
export { buildCopilotContext, renderContext } from './context'
export { SYSTEM_PROMPT, buildUserPrompt, sourceLabel } from './prompts'
export { mockAnswer } from './mock-answer'
export {
  buildAppGuide, renderAppGuide, reaches,
  PRINCIPLES, SURFACES, WORKFLOWS,
  type AppGuide, type GuideAudience, type GuidePrinciple, type GuideSurface,
  type GuideWorkflow,
} from './app-guide'
export {
  APP_HELP_SYSTEM_PROMPT, appHelpSourceLabel, buildAppHelpPrompt, mockAppHelpAnswer,
} from './app-help'
export {
  selectMode, showsHelpLauncher, type CopilotMode, type ModeSelection,
} from './mode'
export {
  getProvider, mockProvider, resolveProviderName,
  type CopilotCall, type CopilotGrounding, type CopilotProvider,
} from './provider'
