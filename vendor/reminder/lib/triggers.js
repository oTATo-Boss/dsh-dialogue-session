/**
 * Trigger engine for dsh-context-reminder.
 *
 * Pure decision logic, isolated from the cordis event wiring so the firing
 * rules are testable without a framework container. The plugin holds one
 * {@link AgentState} per subject agent and advances it as steps and tool
 * calls settle; the two entry points here answer "does this injection fire at this
 * boundary?" for the step boundary (pre-step) and the tool-result boundary
 * (post-execute).
 */

/** The firing conditions an injection can be configured with. */
                                                                                                

/** One configured reminder block. */
                            
                                                                        
                      
                                                                  
                        
     
                                                                           
                                                                            
                                                                            
                                                    
     
                                            
                                                                                             
                      
                                                                                                     
                               
     
                                                                           
                                                                            
                                                                             
                                                                           
                                                                         
                   
     
                               
 

/**
 * Per-agent trigger bookkeeping. The plugin creates one record per subject
 * agent and advances it in the two event handlers; the agent loop serializes
 * those handlers per agent (a step starts, its tool calls settle, the next
 * step starts), so a record is never touched from two live handlers at once.
 */
                             
                                                                                                  
                      
                                                                  
                                      
                                                                                    
                             
 

/** Create the initial per-agent record. */
export function createAgentState()             {
  return {
    stepsInTurn: 0,
    turnDeliveries: new Map(),
    compactionPending: false,
  };
}

/**
 * Whether an injection fires at the step boundary (the pre-step waterfall). The
 * plugin advances the bookkeeping ({@link advanceStep}) before calling this,
 * so the turn-start step reads as step 0 and the first step after it as
 * step 1. The injection fires when any of its listed trigger conditions holds:
 *
 * - turn-start: the step's claimed batch carries a user message (a fresh
 *   turn, or a user message that arrived mid-turn).
 * - every-n-steps: the step counter is a positive multiple of the injection's
 *   interval (interval 1 fires on every step after the turn-start step).
 * - post-compaction: a compaction ended since the injection's last delivery.
 * - on-tool-result: never fires at a step boundary (see {@link firesOnToolResult}).
 *
 * @throws {Error} when an injection whose trigger list contains `every-n-steps`
 *   lacks a positive integer step interval: the engine never defaults or
 *   coerces `n`, so an unvalidated injection fails loud at its first step
 *   (instead of silently firing every step when `n` is absent, or never
 *   firing when `n` is zero).
 *   Callers that build injections by hand (instead of going through
 *   {@link assertValidInjections}) should validate them first.
 */
export function firesAtStep(state            , injection           , isTurnStart         )          {
  return injection.triggers.some((trigger) => {
    switch (trigger) {
      case 'turn-start':
        return isTurnStart;
      case 'every-n-steps': {
        if (typeof injection.n !== 'number' || !Number.isInteger(injection.n) || injection.n < 1) {
          throw new Error(`dsh-context-reminder: injection "${injection.id}" uses every-n-steps without a positive integer step interval (n); validate the injections with assertValidInjections first`)
        }
        return state.stepsInTurn > 0 && state.stepsInTurn % injection.n === 0
      }
      case 'post-compaction':
        return state.compactionPending;
      case 'on-tool-result':
        return false;
    }
  })
}

/** Whether an injection fires on the tool-result boundary (the post-execute waterfall). */
export function firesOnToolResult(injection           )          {
  return injection.triggers.includes('on-tool-result');
}

/** Whether the injection's per-turn limit still allows another delivery. */
export function withinBudget(state            , injection           )          {
  return injection.maxPerTurn === void 0 || (state.turnDeliveries.get(injection.id) ?? 0) < injection.maxPerTurn;
}

/**
 * Record one delivery of an injection against the per-turn budget. The delivery is
 * charged even when the step is later vetoed by another listener, which keeps
 * the gate a strict upper bound on reminder traffic. A delivery of an injection
 * whose trigger list contains 'post-compaction' consumes the compaction flag in
 * the same charge, whatever listed kind fired: the text just re-entered the
 * window, so the re-pin obligation is satisfied.
 */
export function chargeDelivery(state            , injection           )       {
  state.turnDeliveries.set(injection.id, (state.turnDeliveries.get(injection.id) ?? 0) + 1);
  if (injection.triggers.includes('post-compaction')) state.compactionPending = false;
}

/**
 * Advance the bookkeeping once a step has started. A step whose claimed batch
 * carries a user message is a turn boundary: it resets the step counter and
 * the per-turn budget. Every other step (tool-result continuations) only
 * increments the counter. The compaction flag is independent of the turn
 * boundary: a compaction mid-turn must still re-pin the blocks on the next
 * step of the same turn.
 */
export function advanceStep(state            , isTurnStart         )       {
  if (isTurnStart) {
    state.stepsInTurn = 0;
    state.turnDeliveries.clear();
  } else {
    state.stepsInTurn += 1;
  }
}

/**
 * Validate the configured injections for the rules the schema cannot express:
 * unique injection ids (ids key the per-turn budget and the log summary), a
 * trigger list without repeated kinds, and a positive step interval on every
 * injection whose trigger list contains 'every-n-steps'.
 *
 * @throws {Error} with a message naming the first invalid injection.
 */
export function assertValidInjections(injections                      )       {
  const seen = new Set        ();
  for (const injection of injections) {
    if (seen.has(injection.id)) {
      throw new Error(`dsh-context-reminder: duplicate injection id "${injection.id}"; ids key the per-turn budget and the log summary`);
    }
    seen.add(injection.id);
    if (injection.triggers.length === 0) {
      throw new Error(`dsh-context-reminder: injection "${injection.id}" has an empty trigger list; an injection that never fires is a silent misconfiguration`);
    }
    if (new Set(injection.triggers).size !== injection.triggers.length) {
      throw new Error(`dsh-context-reminder: injection "${injection.id}" repeats a trigger kind; list each firing condition at most once`);
    }
    if (injection.triggers.includes('every-n-steps') && (!Number.isInteger(injection.n) || (injection.n ?? 0) < 1)) {
      throw new Error(`dsh-context-reminder: injection "${injection.id}" uses every-n-steps and needs a positive integer step interval (n)`);
    }
  }
}
