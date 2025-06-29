// services/workflow-service.js

/**
 * Cleans up and extracts the initial message from a given workflow JSON.
 * This function is designed to process the workflow data from website.predefinedAnswers
 * to get the starting message for a chat.
 *
 * @param {Object} workflowJson The raw workflow JSON object.
 * @returns {Object} An object containing the initial message and any associated options from the start block.
 * Returns { startMessage: null, startOptions: [] } if the start block is not found.
 */
export function getInitialWorkflowMessage(workflowJson) {
  console.log("WORKFLOW SERVICE LOG: Calling getInitialWorkflowMessage.");
  if (!workflowJson || !workflowJson.blocks || !Array.isArray(workflowJson.blocks)) {
    console.warn("WORKFLOW SERVICE LOG: Invalid workflow JSON provided. Missing 'blocks' array. Returning default.");
    return { startMessage: null, startOptions: [] };
  }

  // Find the 'start' block in the workflow
  const startBlock = workflowJson.blocks.find(block => block.id === "start" && block.type === "start");

  if (startBlock) {
    console.log(`WORKFLOW SERVICE LOG: Found start block (ID: ${startBlock.id}). Message: "${startBlock.message}"`);
    return {
      startMessage: startBlock.message || null,
      startOptions: [], // Start block itself usually doesn't have options
    };
  } else {
    console.warn("WORKFLOW SERVICE LOG: 'start' block not found in the provided workflow JSON. Returning default.");
    return { startMessage: null, startOptions: [] };
  }
}

/**
 * Finds the next block(s) in the workflow based on the current block's ID by consulting the top-level 'connections' array.
 * @param {Object} workflowJson The full workflow JSON.
 * @param {string} currentBlockId The ID of the current block.
 * @param {string} currentBlockType The type of the current block.
 * @param {string} [chosenOption] The text of the option chosen by the user if the current block's *predecessor* was an 'option' block.
 * @returns {Array<Object>} An array of the next block objects.
 */
export function getNextBlocks(workflowJson, currentBlockId, currentBlockType, chosenOption = null) {
    console.log(`WORKFLOW SERVICE LOG: getNextBlocks called for currentBlockId: ${currentBlockId}, type: ${currentBlockType}, chosenOption: "${chosenOption}".`);

    const directConnectionsFromCurrentBlock = workflowJson.connections.filter(
        conn => conn.from === currentBlockId
    );

    if (directConnectionsFromCurrentBlock.length === 0) {
        console.log(`WORKFLOW SERVICE LOG: getNextBlocks: No outgoing connections found for block ${currentBlockId}. Returning empty.`);
        return [];
    }

    let identifiedNextBlocks = [];

    if (currentBlockType === "option") {
        const currentBlockOptions = getBlockById(workflowJson, currentBlockId)?.options;
        const optionIndex = currentBlockOptions ? currentBlockOptions.indexOf(chosenOption) : -1;

        if (optionIndex !== -1) {
            const specificConnection = directConnectionsFromCurrentBlock.find(conn => conn.fromOptionIndex === optionIndex);
            if (specificConnection) {
                const nextBlock = workflowJson.blocks.find(block => block.id === specificConnection.to);
                if (nextBlock) {
                    identifiedNextBlocks.push(nextBlock);
                    console.log(`WORKFLOW SERVICE LOG: getNextBlocks: For option block ${currentBlockId}, matching chosen option index ${optionIndex} to block ${nextBlock.id}.`);
                } else {
                    console.warn(`WORKFLOW SERVICE LOG: getNextBlocks: Next block for specific connection from option ${currentBlockId} (index ${optionIndex}) not found. Connection: ${JSON.stringify(specificConnection)}.`);
                }
            } else {
                console.warn(`WORKFLOW SERVICE LOG: getNextBlocks: No specific connection found for option block ${currentBlockId} with chosen option index ${optionIndex}.`);
            }
        } else {
            console.log(`WORKFLOW SERVICE LOG: getNextBlocks: Chosen option "${chosenOption}" not found in options for block ${currentBlockId}.`);
        }
    } else if (currentBlockType === "condition") {
        if (directConnectionsFromCurrentBlock.length > 0) {
            const nextBlock = workflowJson.blocks.find(block => block.id === directConnectionsFromCurrentBlock[0].to);
            if (nextBlock) {
                identifiedNextBlocks.push(nextBlock);
                console.log(`WORKFLOW SERVICE LOG: getNextBlocks: For condition block ${currentBlockId}, identifying first connected block: ${nextBlock.id}.`);
            }
        }
    } else { // Handles "start", "message", "userResponse", "end"
        if (directConnectionsFromCurrentBlock.length > 0) {
            const nextBlock = workflowJson.blocks.find(block => block.id === directConnectionsFromCurrentBlock[0].to);
            if (nextBlock) {
                identifiedNextBlocks.push(nextBlock);
                console.log(`WORKFLOW SERVICE LOG: getNextBlocks: For sequential block ${currentBlockId} (type: ${currentBlockType}), identified next block: ${nextBlock.id}.`);
            }
        }
    }

    return identifiedNextBlocks;
}

/**
 * Processes a single block and determines the response.
 * @param {Object} block The current block to process.
 * @param {string} lastUserMessage The last message sent by the user (for {{response}} replacement).
 * @returns {Object} An object containing the response message, options, and whether the workflow should end.
 */
export function processWorkflowBlock(block, lastUserMessage) {
    console.log(`WORKFLOW SERVICE LOG: Processing block (ID: ${block.id}, Type: ${block.type}).`);
    const response = {
        message: null,
        options: [],
        endWorkflow: false, // This flag now indicates a workflow path completion, NOT chat closure
        requiresUserInput: false, // Indicates if this block, *after being displayed*, requires user input
        sendTelegramNotification: false, // Flag to explicitly trigger notification
    };

    switch (block.type) {
        case "start":
            console.log(`WORKFLOW SERVICE LOG: Block type 'start' (ID: ${block.id}). Message: "${block.message}".`);
            response.message = block.message;
            response.requiresUserInput = false; // Start block just initiates the conversation
            break;

        case "userResponse": // This block explicitly waits for user input
            console.log(`WORKFLOW SERVICE LOG: Block type 'userResponse' (ID: ${block.id}). This block requires user input.`);
            response.message = null; // User response block itself doesn't send a message
            response.requiresUserInput = true; // This block explicitly waits for user input
            break;

        case "message":
            let messageText = block.message || "";
            if (lastUserMessage && messageText.includes("{{responce}}")) {
                messageText = messageText.replace("{{responce}}", lastUserMessage);
                console.log(`WORKFLOW SERVICE LOG: Message block (ID: ${block.id}) - Replaced '{{responce}}' with "${lastUserMessage}". New message: "${messageText}".`);
            } else {
                console.log(`WORKFLOW SERVICE LOG: Message block (ID: ${block.id}). Message: "${messageText}".`);
            }
            response.message = messageText;
            response.requiresUserInput = false; // A message block itself doesn't wait for input
            break;

        case "option":
            console.log(`WORKFLOW SERVICE LOG: Option block (ID: ${block.id}). Options: ${JSON.stringify(block.options)}.`);
            response.options = block.options || [];
            response.message = block.message || "Please choose one"; // Message shown if option block is the prompt
            response.requiresUserInput = true; // Option blocks *always* wait for user input
            break;

        case "condition":
            console.log(`WORKFLOW SERVICE LOG: Condition block (ID: ${block.id}). Selected condition: "${block.selectedCondition}".`);
            response.requiresUserInput = false; // Condition blocks are internal flow control, don't display to user
            break;

        case "end":
            // End block now triggers notification and signifies workflow path completion,
            // but does NOT inherently close the chat or stop the *entire* bot's function.
            console.log(`WORKFLOW SERVICE LOG: End block (ID: ${block.id}). Message: "${block.message}". Signaling Telegram notification.`);
            response.message = block.message || "Thank you, please wait for the agent to contact you";
            response.endWorkflow = true; // Still marks as end of this workflow path
            response.sendTelegramNotification = true; // Explicitly trigger notification
            response.requiresUserInput = false; // It passes control after its message
            break;

        default:
            console.warn(`WORKFLOW SERVICE LOG: Unknown block type encountered: ${block.type} for ID: ${block.id}. Returning end workflow.`);
            response.message = "An error occurred in the workflow.";
            response.endWorkflow = true; // Default to ending if unknown
            response.requiresUserInput = false;
    }

    return response;
}

/**
 * Retrieves a block by its ID from the workflow JSON.
 * @param {Object} workflowJson The full workflow JSON.
 * @param {string} blockId The ID of the block to retrieve.
 * @returns {Object|null} The block object or null if not found.
 */
export function getBlockById(workflowJson, blockId) {
    const block = workflowJson.blocks.find(b => b.id === blockId);
    if (!block) {
        console.warn(`WORKFLOW SERVICE LOG: Block with ID ${blockId} not found in workflow. This might indicate a broken connection.`);
    }
    return block;
}

/**
 * Traverses the workflow to find the next active block(s) based on current state and user input.
 * This is the main function to advance the workflow.
 * @param {Object} workflowJson The full workflow JSON.
 * @param {string} currentWorkflowPositionId The ID of the block where the chat currently is.
 * @param {string} lastUserMessage The last message sent by the user.
 * @param {string} [chosenOption] The text of the option chosen by the user (for option/condition blocks).
 * @returns {Object} An object containing an array of workflow responses, and the new workflow position ID.
 */
export function advanceWorkflow(workflowJson, currentWorkflowPositionId, lastUserMessage, chosenOption = null) {
    console.log(`WORKFLOW SERVICE LOG: advanceWorkflow called. Current position ID: "${currentWorkflowPositionId}", User Message: "${lastUserMessage}", Chosen Option: "${chosenOption}".`);
    const responses = [];
    let blocksToProcessQueue = []; // Blocks to process sequentially in this single call to advanceWorkflow
    let nextWorkflowBlockIdToStore = currentWorkflowPositionId; // This will be the ID of the block where the workflow stops and waits

    if (!workflowJson || !workflowJson.blocks || !Array.isArray(workflowJson.blocks)) {
        console.error("WORKFLOW SERVICE LOG: advanceWorkflow: Invalid workflow JSON. Cannot advance.");
        return { responses: [{ message: "An internal workflow error occurred. Please contact support.", endWorkflow: true }], nextWorkflowBlockId: null };
    }

    let startingBlockForThisTurn = getBlockById(workflowJson, currentWorkflowPositionId);

    if (!startingBlockForThisTurn) {
         console.error(`WORKFLOW SERVICE LOG: advanceWorkflow: Current workflow position ID "${currentWorkflowPositionId}" not found in workflow blocks. This state is inconsistent.`);
         return { responses: [{ message: "An internal workflow error occurred. Unable to determine next step in workflow.", endWorkflow: true }], nextWorkflowBlockId: null };
    }

    // --- Determine the initial block(s) to add to the processing queue for this turn based on current position ---
    if (startingBlockForThisTurn.type === "start") {
        // This case processes the 'start' block's message then immediately chains to the next.
        // It's the starting point from which we determine the *first user-response-waiting block*.
        console.log(`WORKFLOW SERVICE LOG: Current position is 'start' (${startingBlockForThisTurn.id}). Processing and finding next connected block.`);
        // No need to process Start message here again, `create_new_chat` already sent it.
        // Just find what it leads to and put that into the queue.
        const nextBlocksFromStart = getNextBlocks(workflowJson, startingBlockForThisTurn.id, startingBlockForThisTurn.type);
        if (nextBlocksFromStart.length > 0) {
            blocksToProcessQueue.push(nextBlocksFromStart[0]); // Add the block connected to 'start' (e.g., userResponse1)
            console.log(`WORKFLOW SERVICE LOG: Adding block ${nextBlocksFromStart[0].id} (Type: ${nextBlocksFromStart[0].type}) to queue from 'start'.`);
        } else {
            console.warn("WORKFLOW SERVICE LOG: 'start' block has no outgoing connections. Workflow will effectively end after initial greeting.");
            return { responses: [], nextWorkflowBlockId: startingBlockForThisTurn.id }; // Workflow effectively ends here.
        }
    } else if (startingBlockForThisTurn.type === "userResponse" || startingBlockForThisTurn.type === "option") {
        console.log(`WORKFLOW SERVICE LOG: Current position is a user input block (${startingBlockForThisTurn.id}, Type: ${startingBlockForThisTurn.type}). User has just provided input.`);
        
        let nextBlocksAfterUserInput = [];

        if (startingBlockForThisTurn.type === "option") {
            // Options are evaluated by matching chosenOption (user's message) with block options
            nextBlocksAfterUserInput = getNextBlocks(workflowJson, startingBlockForThisTurn.id, startingBlockForThisTurn.type, chosenOption);
            if (nextBlocksAfterUserInput.length === 0) {
                console.log(`WORKFLOW SERVICE LOG: Invalid option "${chosenOption}" chosen for option block ${startingBlockForThisTurn.id}. Reprompting.`);
                // If invalid option, reprompt with the same options from this block
                return { responses: [processWorkflowBlock(startingBlockForThisTurn, lastUserMessage)], nextWorkflowBlockId: startingBlockForThisTurn.id };
            }
        } else { // userResponse block
            // userResponse blocks don't have specific options; they simply pass control based on generic input.
            // We just need to find what they connect to.
            nextBlocksAfterUserInput = getNextBlocks(workflowJson, startingBlockForThisTurn.id, startingBlockForThisTurn.type);
        }

        if (nextBlocksAfterUserInput.length > 0) {
            blocksToProcessQueue.push(nextBlocksAfterUserInput[0]);
            console.log(`WORKFLOW SERVICE LOG: After user input at ${startingBlockForThisTurn.id}, next in queue: ${nextBlocksAfterUserInput[0].id} (Type: ${nextBlocksAfterUserInput[0].type}).`);
        } else {
            console.warn(`WORKFLOW SERVICE LOG: User input block ${startingBlockForThisTurn.id} has no outgoing connections. Workflow effectively ends here.`);
            // If an input block has no outgoing connections, it implies a logical end to this branch.
            // It sends a simple "Thank you" and is marked as an end for the workflow path.
            // Importantly, it also triggers a notification and falls through to AI.
            return { responses: [{ message: "Thank you for your response. Our team will get back to you shortly.", endWorkflow: true, sendTelegramNotification: true }], nextWorkflowBlockId: startingBlockForThisTurn.id };
        }

    } else if (startingBlockForThisTurn.type === "condition") {
        console.log(`WORKFLOW SERVICE LOG: Current position is a Condition block (${startingBlockForThisTurn.id}). Evaluating: "${startingBlockForThisTurn.selectedCondition}" vs user input "${chosenOption}".`);
        // Conditions are based on the *previous* user input. If this condition is the current block,
        // it means the workflow advanced to it, and we now evaluate the condition based on the user's latest input.
        if (chosenOption === startingBlockForThisTurn.selectedCondition) {
            console.log(`WORKFLOW SERVICE LOG: Condition "${startingBlockForThisTurn.selectedCondition}" met for block ${startingBlockForThisTurn.id}.`);
            const nextBlocksAfterCondition = getNextBlocks(workflowJson, startingBlockForThisTurn.id, startingBlockForThisTurn.type);
            if (nextBlocksAfterCondition.length > 0) {
                blocksToProcessQueue.push(nextBlocksAfterCondition[0]);
                console.log(`WORKFLOW SERVICE LOG: Following condition true path to block ${nextBlocksAfterCondition[0].id} (Type: ${nextBlocksAfterCondition[0].type}).`);
            } else {
                console.warn(`WORKFLOW SERVICE LOG: Condition block ${startingBlockForThisTurn.id} has no outgoing connections after being met.`);
            }
        } else {
            console.log(`WORKFLOW SERVICE LOG: Condition "${startingBlockForThisTurn.selectedCondition}" NOT met by chosen option "${chosenOption}" for block ${startingBlockForThisTurn.id}. Workflow cannot advance from this path.`);
            return { responses: [], nextWorkflowBlockId: currentWorkflowPositionId }; // No path to proceed
        }
    } else {
        // This 'else' branch implies that `currentWorkflowPositionId` was set to a non-input-requiring block type (like message, or end).
        // This should not happen if `nextWorkflowBlockIdToStore` is always correctly set
        // to a block that truly waits for user input (userResponse or option).
        // If it's hit, it implies a logical flow error or unhandled block type from previous state.
        console.warn(`WORKFLOW SERVICE LOG: Unexpected current workflow position type: ${startingBlockForThisTurn.type} for ID: ${currentWorkflowPositionId}. This block should not be a waiting point for direct user input. Returning no response.`);
        return { responses: [], nextWorkflowBlockId: currentWorkflowPositionId };
    }


    // --- Core Sequential Block Processing Loop ---
    // This loop processes blocks that *do not* require user input (message, condition)
    // allowing them to chain together until an input-requiring block is hit or the workflow ends.
    while (blocksToProcessQueue.length > 0) {
        const block = blocksToProcessQueue.shift();
        if (!block) {
            console.warn("WORKFLOW SERVICE LOG: Encountered a null block in blocksToQueue. Skipping.");
            continue;
        }

        console.log(`WORKFLOW SERVICE LOG: Executing queued block: ID=${block.id}, Type=${block.type}.`);
        const blockResponse = processWorkflowBlock(block, lastUserMessage);
        
        // Always update the nextWorkflowBlockIdToStore to the block currently being processed.
        nextWorkflowBlockIdToStore = block.id;

        // Add to responses if it's user-facing or signals end (message needs to be non-null)
        if (blockResponse.message !== null || blockResponse.options.length > 0 || blockResponse.endWorkflow) {
            responses.push(blockResponse);
            console.log(`WORKFLOW SERVICE LOG: Added response for block ${block.id}. Message: "${blockResponse.message || 'N/A'}", Options: ${JSON.stringify(blockResponse.options)}, End: ${blockResponse.endWorkflow}, Requires Input: ${blockResponse.requiresUserInput}, Send Telegram: ${blockResponse.sendTelegramNotification}.`);
        }

        if (blockResponse.endWorkflow) {
            // The `endWorkflow` flag indicates the defined workflow path has completed.
            // It does NOT break the sequential processing here; we continue to find next logical steps
            // (e.g., implicitly falling through to AI/staff handoff).
            console.log(`WORKFLOW SERVICE LOG: End block ${block.id} processed. Signaling completion of defined path.`);
            // The AI/staff handoff logic will occur after `advanceWorkflow` returns.
        }

        if (blockResponse.requiresUserInput) {
            // If this block requires user input (e.g., an option or userResponse block), stop chaining.
            console.log(`WORKFLOW SERVICE LOG: Block ${block.id} (Type: ${block.type}) requires user input. Stopping sequential chain.`);
            break; // Break the while loop, wait for user
        } else {
            // For blocks that don't require user input (message, condition, end), continue chaining
            const nextConnectedBlocks = getNextBlocks(workflowJson, block.id, block.type);
            if (nextConnectedBlocks.length > 0) {
                 const firstNextBlock = nextConnectedBlocks[0]; // Assuming sequential flow for now

                 // Special handling for Message -> Option sequence where options are attached to the message
                 if (block.type === "message" && firstNextBlock.type === "option") {
                     const optionBlockResponse = processWorkflowBlock(firstNextBlock, lastUserMessage);
                     
                     // Find the last response that has a message and merge options into it.
                     let merged = false;
                     for (let i = responses.length - 1; i >= 0; i--) {
                         if (responses[i].message !== null) { // Find a message response to append options to
                             responses[i].options = optionBlockResponse.options;
                             responses[i].requiresUserInput = optionBlockResponse.requiresUserInput; // This will cause break in next check
                             console.log(`WORKFLOW SERVICE LOG: Message block ${block.id} followed by Option block ${firstNextBlock.id}. Merging options into message from ${responses[i].message.substring(0, Math.min(responses[i].message.length, 20))}...`);
                             merged = true;
                             break;
                         }
                     }
                     if (!merged) {
                         // Fallback: If no message response to attach to, just push the option block's response directly
                         responses.push(optionBlockResponse);
                         console.log(`WORKFLOW SERVICE LOG: Option block ${firstNextBlock.id} processed as standalone response.`);
                     }
                     nextWorkflowBlockIdToStore = firstNextBlock.id; // Workflow pauses at the option block
                     break; // Stop chaining, as an option block implies waiting for user
                 } else if (firstNextBlock.type === "condition" || firstNextBlock.type === "message" || firstNextBlock.type === "end") {
                    // These types typically chain without waiting for user. Add them to the queue for processing.
                    blocksToProcessQueue.push(firstNextBlock);
                    console.log(`WORKFLOW SERVICE LOG: Block ${block.id} leads to ${firstNextBlock.id} (Type: ${firstNextBlock.type}). Adding to queue.`);
                 } else if (firstNextBlock.type === "userResponse" || firstNextBlock.type === "option") {
                    // If a non-input block leads to an input-requiring block, process it and then stop the chain.
                    blocksToProcessQueue.push(firstNextBlock);
                    console.log(`WORKFLOW SERVICE LOG: Block ${block.id} leads to user input block ${firstNextBlock.id}. Adding to queue and will break.`);
                 }

            } else {
                console.log(`WORKFLOW SERVICE LOG: No further connections from block ${block.id}. End of sequential chain for this path.`);
                // If no more connections after this block, then the workflow path truly ends here.
                nextWorkflowBlockIdToStore = block.id;
                // Since there are no more blocks defined in the workflow path,
                // we've reached the end of the *workflow's defined path*.
                // This means control should now pass to AI/staff.
                // Mark the last response as `endWorkflow` to signal this.
                if (responses.length > 0) {
                    responses[responses.length - 1].endWorkflow = true; // Mark last visible response as end of path
                }
                break;
            }
        }
    }

    // If no responses were generated by the workflow, ensure nextWorkflowBlockId is correctly returned
    if (responses.length === 0) {
        console.log(`WORKFLOW SERVICE LOG: advanceWorkflow generated no user-facing responses. Next workflow block remains ${currentWorkflowPositionId}.`);
        return { responses: [], nextWorkflowBlockId: nextWorkflowBlockIdToStore || currentWorkflowPositionId };
    }

    // All responses generated are collected, now return the final determined workflow position
    console.log(`WORKFLOW SERVICE LOG: advanceWorkflow returning with final nextWorkflowBlockId: "${nextWorkflowBlockIdToStore}".`);
    return { responses, nextWorkflowBlockId: nextWorkflowBlockIdToStore };
}