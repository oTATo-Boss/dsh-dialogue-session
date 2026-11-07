/**
 * dsh-context-reminder - re-post standing context blocks to dsh agents at
 * configured firing points (turn start, tool-result boundaries, step
 * intervals, and after a session compaction).
 *
 * Motivation: long-running turns drift away from rules stated once, and a
 * compaction can summarize away standing rules that live only in the message
 * history (early user messages, previously delivered notice blocks).
 * The framework's own runtime-context projection re-announces its sections,
 * but a host has no way to make arbitrary standing blocks (discipline for the
 * model's output channel, output conventions) survive the same way. This
 * plugin adds a configurable re-pinning channel: each configured injection
 * fires when any of its listed trigger conditions holds, and the plugin
 * appends at most one user-role notice message per firing boundary carrying
 * the injection's text, with a `context-reminder` producer source so the
 * injections are auditable and filterable in the durable session log.
 *
 * Wiring: the plugin subscribes to three dsh framework events.
 * `agent/pre-step` is the per-step waterfall that decides a step's input
 * messages (step-boundary injections); `tools/post-execute` is the per-tool
 * waterfall whose decision may carry `additionalContexts` that the agent
 * loop folds into the next step's input (tool-result-boundary injections);
 * `session/event` observes compaction endings so the next step boundary
 * re-pins the blocks again (the self-healing property).
 *
 * Which context the listeners attach to is chosen from the plugin context's
 * own scope tag (dsh-scope), which is the framework's own membership
 * routing - no per-event filter is needed:
 * - An untagged context (a host-level entry) listens on the runtime root.
 *   The root context is untagged, and scope routing admits untagged
 *   listeners on every scoped dispatch, so such an instance serves every
 *   agent the host runs.
 * - A preset entry runs inside its preset's standing scope (the registry
 *   mints that scope and instantiates the preset's entries under it). An
 *   agent that joined the preset is parented to exactly that standing
 *   scope, and scope routing admits a listener owned by an enclosing scope
 *   to every descendant's events. Listening on the preset's own scope
 *   therefore reaches precisely the agents composed under that preset -
 *   including their subagents, which join the same standing composition -
 *   and no agent of any other preset.
 * `session/event` is the one exception to that carrier choice: the session
 * store dispatches session events routed by its own (untagged) service
 * context, and scope routing admits only untagged listeners to that event.
 * The compaction observer therefore always registers on the runtime root in
 * both forms; its session-to-agent attribution, filled only by agents that
 * ran a step through this instance's listeners, keeps it a no-op for any
 * session this instance does not own.
 * The framework fuses the subject agent into every agent-event payload,
 * which is what the per-agent state (step counter, per-turn budget,
 * compaction flag) is keyed on. A host that serves several agents through
 * one plugin instance is supported: the bookkeeping is a per-agent record,
 * never shared. An injection configured with `subagents: false` delivers
 * only to top-level agent sessions: the plugin reads the agent's delegation
 * depth the way the framework's own depth accessor does (the durable
 * session-header value and the in-process runtime value, the larger of the
 * two) and skips agents whose depth is above zero.
 */
import Schema from '@deepseek-ai/schemastery'
                                                  
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
                                                       
import {
  advanceStep,
  assertValidInjections,
  chargeDelivery,
  createAgentState,
  firesAtStep,
  firesOnToolResult,
  withinBudget,
                  
                 
} from './triggers.js'
import { scopeOf } from '@deepseek-ai/dsh-scope'
             
           
                  
                 
                      
               
                  
                   

/** The plugin name; cordis profile entries reference it by this id. */
export const name = 'dsh-context-reminder'

/**
 * Plugin configuration. `injections` is optional: a profile entry that
 * installs the plugin without injections (for example the host-level bundle patch)
 * registers the plugin inert - it wires nothing and injects nothing. The
 * injections are supplied by the agent preset entries that carry this plugin.
 */
                                        
                                                                                    
                                             
 

/**
 * The configuration schema, validated by the loader before {@link apply}
 * runs. It keeps the flat shape (a trigger list plus optional scalars) so
 * the validation stays one level deep; the remaining cross-field rules -
 * the trigger list without repeated kinds, and `n` required and positive
 * when the list contains `every-n-steps` - are enforced fail-loud in
 * {@link apply} via {@link assertValidInjections}.
 *
 * The export is typed `unknown` rather than the inferred schema type: the
 * inferred type references transitive framework types (schemastery's
 * cosmokit dependency) whose files live outside this package, which the
 * declaration emit cannot name portably. The loader consumes the object at
 * runtime (`Config["~standard"].validate`), so the type surface loses
 * nothing the host code reads; {@link ContextReminderConfig} keeps the full
 * static typing for the config value itself.
 */
export const Config          = Schema.object({
  injections: Schema.array(
    Schema.object({
      id: Schema.string().min(1).required().description('Unique injection id; doubles as the durable-log notice summary'),
      text: Schema.string().min(1).required().description('The model-facing text re-posted when the injection fires'),
      triggers: Schema.array(
        Schema.union([
          Schema.const('turn-start'),
          Schema.const('on-tool-result'),
          Schema.const('every-n-steps'),
          Schema.const('post-compaction'),
        ]),
      ).min(1).description(
        'The firing conditions, of which any may be listed; the injection fires when at least one holds, at most once per boundary. Repeated kinds are rejected; containing every-n-steps additionally requires a positive integer n',
      ),
      n: Schema.natural().min(1).description('Step interval for the every-n-steps trigger (required when that trigger is listed)'),
      subagents: Schema.boolean().description(
        'When false the injection fires only for top-level agent sessions (delegation depth zero); absent or true it also fires for subagent sessions',
      ),
      maxPerTurn: Schema.natural().min(1).description('Per-turn limit: at most this many deliveries of the injection per turn (absent = unbounded)'),
    }),
  ).description('The reminder injections to deliver (absent or empty = registered but inert)'),
})

/**
 * Install the reminder listeners. The listeners attach to the plugin
 * context's own scope when it is scoped (a preset entry running inside its
 * preset's standing scope) and to the runtime root otherwise (an untagged
 * host-level entry). The scope routing itself is the membership check: a
 * root listener is admitted on every dispatch and serves all agents, while
 * a listener owned by a preset's standing scope is admitted only to the
 * agents parented under that scope.
 *
 * @param ctx - the plugin context the listeners attach to.
 * @param config - the validated plugin configuration.
 * @throws {Error} when the injections violate the rules the schema cannot express
 *   (duplicate ids, a trigger list with repeated kinds, a missing or
 *   non-positive step interval).
 */
export function apply(ctx         , config                       )       {
  const injections = config.injections ?? []
  if (injections.length === 0) return
  assertValidInjections(injections)

  // The listener carrier, chosen from the plugin context's own scope tag.
  // An untagged context is a host-level entry: it listens on the runtime
  // root (untagged, admitted on every scoped dispatch) and serves every
  // agent the host runs. A scoped context is a preset entry living inside
  // its preset's standing scope: it listens there, and scope routing
  // admits it only to the agents parented under that scope (the agents
  // composed with this preset, plus their subagents).
  const listenOn = scopeOf(ctx) === void 0 ? ctx.root : ctx

  // Per-agent bookkeeping, keyed by the subject agent object the framework
  // fuses into every agent-event payload. The agent loop serializes the two
  // mutating handlers per agent (a step starts, its tool calls settle, the
  // next step starts), so a record is never written from two live handlers
  // at once.
  const states = new WeakMap                    ()
  const stateOf = (agent        )             => {
    const existing = states.get(agent)
    if (existing !== void 0) return existing
    const created = createAgentState()
    states.set(agent, created)
    return created
  }

  // Session -> subject agent, filled lazily as agents run steps. The
  // compaction observer needs it to attribute a session-log event to the
  // agent that owns the session; any session that compacted has by then
  // already run at least one step, so the entry is in place when consulted.
  const agentBySession = new WeakMap                ()
  const noteAgent = (agent          )       => {
    const session = agent.session
    if (session !== void 0) agentBySession.set(session, agent)
  }

  // The agent's delegation depth, read the way the framework's own depth
  // accessor reads it: the durable session-header value and the in-process
  // runtime value, the larger of the two (a top-level session carries
  // neither and reads as zero). The subagents filter of an injection is
  // applied against this reading.
  const delegationDepthOf = (agent          )         =>
    Math.max(agent.session?.header?.delegationDepth ?? 0, agent.options?.subagentDepth ?? 0)

  const buildMessage = (injection           )              =>
    createUserMessage({
      content: [{ type: 'text', text: injection.text }],
      source: {
        kind: 'context-reminder',
        form: 'notice',
        summary: boundContextSummary(injection.id),
      },
    })

  /**
   * Deliver every injection that fires at the boundary the caller names and is
   * within its per-turn budget, charging each delivery. Shared by the two
   * waterfalls; only the firing predicate differs (step boundary vs
   * tool-result boundary), so the budget and accounting logic lives in one
   * place.
   */
  const collectInjections = (state            , depth        , predicate                                   )                => {
    const injected                = []
    for (const injection of injections) {
      if (injection.subagents === false && depth > 0) continue
      if (!predicate(injection) || !withinBudget(state, injection)) continue
      injected.push(buildMessage(injection))
      chargeDelivery(state, injection)
    }
    return injected
  }

  // Step-boundary injections: the pre-step waterfall decides the step's input
  // messages; the plugin appends its injections after the rest of the chain
  // (which is where the framework's own runtime-context projection appends
  // its re-announcement, so reminder blocks trail it in the same slot).
  listenOn.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
    const state = stateOf(payload.agent)
    noteAgent(payload.agent)
    const isTurnStart = payload.messages.some((message) => message.source.kind === 'user')
    advanceStep(state, isTurnStart)
    const injected = collectInjections(state, delegationDepthOf(payload.agent), (injection) => firesAtStep(state, injection, isTurnStart))
    if (injected.length === 0) return decision
    return { ...decision, messages: [...decision.messages, ...injected] }
  })

  // Tool-result-boundary injections: the post-execute waterfall settles one tool
  // call; the decision's additionalContexts are folded by the agent loop
  // into the next step's input (the same channel a host agent uses to
  // re-state a rule mid-turn).
  listenOn.on('tools/post-execute', async (exec, _result, next) => {
    const downstream = await next()
    const state = stateOf(exec.agent)
    noteAgent(exec.agent)
    const injected = collectInjections(state, delegationDepthOf(exec.agent), (injection) => firesOnToolResult(injection))
    if (injected.length === 0) return downstream
    return { ...downstream, additionalContexts: [...(downstream.additionalContexts ?? []), ...injected] }
  })

  // Compaction endings: mark the agent so the next step boundary re-pins the
  // blocks. A compaction mid-turn must re-pin on the next step of the same
  // turn, so the flag is independent of the turn-boundary reset. This
  // observer ignores the carrier choice on purpose: the session store
  // dispatches session events routed by its own (untagged) service context,
  // and scope routing admits only untagged listeners to that event, so the
  // subscription registers on the runtime root in every form. The
  // session-to-agent map only ever holds agents that ran a step through this
  // instance's listeners, so a compaction on any other session is a no-op.
  ctx.root.on('session/event', (subject, event) => {
    if (event.type !== 'compaction/end') return
    const agent = agentBySession.get(subject)
    if (agent === void 0) return
    stateOf(agent).compactionPending = true
  })
}

// The dsh framework event names are outside cordis's typing, so the three
// subscriptions this plugin uses are declared as narrow overloads on the
// Context interface: each names the exact payload and decision shapes the
// plugin reads, and any other event name (including a typo) is a compile
// error rather than a silent runtime miss.
                                      
                     
                                                                       
       
                              
                 
                                
                                             
                                                      
               
                                                                                   
       
                                  
                 
                              
                        
                                                 
                                                              
               
                                                                                          
                                                                                                  
   
 
