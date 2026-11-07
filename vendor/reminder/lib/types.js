/**
 * Type surface for dsh-context-reminder.
 *
 * The dsh framework does not publish TypeScript typings for the event payloads
 * it dispatches on `agent/pre-step`, `tools/post-execute`, and `session/event`,
 * so this module declares narrow local interfaces that carry exactly the fields
 * the plugin reads. The plugin casts the untyped cordis payloads to these
 * shapes at the event-registration sites (the same narrow-cast pattern used
 * for untyped framework event payloads).
 */

/**
 * Declare the plugin's own message-source kind into the dsh-llm source map, so
 * a `context-reminder` source type-checks against `createUserMessage`. The
 * producer kind is merge-extensible by design: each plugin declares its own
 * `kind`, and consumers switch on it and fall through on unknown kinds.
 */
                                       
                              
                                                                      
                         
                                                                                      
                                        
                                                                                       
                              
                                                                                                     
                               
      
   
 

/**
 * A user-role message as the dsh-llm layer represents it. Only the fields the
 * plugin produces or inspects are named; the full type lives in dsh-llm.
 */
                                  
                                                         
                      
                                       
                                                                                
                                                                                    
                    
                                      
                            
                             
    
 

/**
 * Minimal structural view of the agent subject the framework fuses into every
 * agent-event payload. `session` (identity plus the durable delegation depth
 * the framework writes into the session header) correlates a compaction event
 * back to the agent that owns it; `options` carries the in-process runtime
 * delegation depth. The plugin reads the agent's delegation depth as the
 * larger of the two, mirroring the framework's own depth accessor. Both
 * fields are optional so a host whose agent does not expose them degrades the
 * correlation to a no-op and the depth reading to a top-level default.
 */
                           
                                                                             
                      
                                                            
                       
                                                                                                    
                                        
      
    
                                                                       
                      
                                                                               
                                    
    
 

/** The `agent/pre-step` waterfall payload, as the framework dispatches it. */
                                 
                                                                                      
                                                                               
                                                                               
                           
 

/** The `tools/post-execute` waterfall subject (one tool call about to settle). */
                                  
                                                  
                           
 

/** A session-log event as recorded on the session. */
                               
                                                             
                        
 

/**
 * A step-input or tool-context message slot. Broad on purpose: a decision's
 * message array mixes this plugin's reminder blocks with the inbox messages
 * and runtime context the framework appends, so the array is typed as plain
 * objects and narrowed only where the plugin produces a block of its own.
 */
                                 

/**
 * The `tools/post-execute` decision a listener returns after calling next().
 * The plugin reads only `kind` (implicitly, by passing the decision through)
 * and `additionalContexts`; every other field (including the block feedback)
 * is opaque pass-through and deliberately not declared.
 */
                                      
                                                                
                                    
                                                                                
                                                       
 

/** The `agent/pre-step` decision the default handler (and listeners) return. */
                                  
                                                                              
                        
                                                                      
                                             
 
