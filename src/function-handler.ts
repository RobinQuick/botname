
async function handleFunctionCall(session: SessionState, item: any) {
    const { name, call_id, arguments: argsString } = item;
    let args;

    try {
        args = JSON.parse(argsString);
    } catch (e) {
        logger.error({ sessionId: session.id, error: e }, 'Failed to parse function arguments');
        return;
    }

    logger.info({ sessionId: session.id, function: name, args }, 'Executing function call');

    let result: any = { success: true };
    const catalogue = catalogueService.getCatalogue(session.storeId);
    const menuRules = catalogueService.getMenuRules(session.storeId);
    let orderUpdated = false;

    if (name === 'add_item') {
        const engineResult = orderEngine.addItemToOrder(
            session.order,
            {
                productName: args.productName,
                quantity: args.quantity,
                size: args.size,
                modifiers: args.modifiers
            },
            catalogue,
            menuRules
        );
        if (engineResult.success && engineResult.data) {
            session.order = engineResult.data;
            orderUpdated = true;
            result = { success: true, message: 'Item added successfully' };
        } else {
            result = { success: false, message: engineResult.error };
        }
    } else if (name === 'remove_item') {
        const engineResult = orderEngine.removeItemByName(
            session.order,
            args.productName,
            catalogue
        );
        if (engineResult.success && engineResult.data) {
            session.order = engineResult.data;
            orderUpdated = true;
            result = { success: true, message: 'Item removed successfully' };
        } else {
            result = { success: false, message: engineResult.error };
        }
    } else if (name === 'confirm_order') {
        if (session.testMode) {
            session.order.status = 'sent_to_pos';
            session.order.posOrderId = `TEST-${Date.now()}`;
            orderUpdated = true;
            result = { success: true, message: 'Order confirmed in test mode' };
        } else {
            const posResult = await posAdapter.createOrder(session.order);
            if (posResult.success) {
                session.order.status = 'sent_to_pos';
                session.order.posOrderId = posResult.orderId;
                orderUpdated = true;
                result = { success: true, message: 'Order sent to POS' };
            } else {
                result = { success: false, message: 'Failed to send to POS' };
            }
        }
    }

    // Update client UI
    if (orderUpdated) {
        sendToClient(session, {
            type: 'order_update',
            order: orderEngine.generateOrderDisplayData(session.order)
        });
    }

    // Send result back to OpenAI
    if (session.openaiWs && session.openaiWs.readyState === WebSocket.OPEN) {
        session.openaiWs.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
                type: 'function_call_output',
                call_id: call_id,
                output: JSON.stringify(result)
            }
        }));

        // Trigger response generation based on the tool output
        session.openaiWs.send(JSON.stringify({
            type: 'response.create'
        }));
    }
}
