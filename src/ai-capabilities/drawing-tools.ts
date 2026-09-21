import { CapabilityError, type JsonValue, type ToolDefinition, type ValueSchema } from './contracts.ts';
import { DrawingChangeManager } from './drawing-changes.ts';
import { DRAWING_LIMITS, emptyObjectSchema, objectSchema } from './drawing-contract.ts';

/** Transport-neutral tools. Native host binding and permission grants are separate. */
export function createDrawingTools(manager: DrawingChangeManager): readonly ToolDefinition[] {
  const id: ValueSchema = { type: 'string', maxLength: 128 };
  const version: ValueSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
  const op: ValueSchema = { type: 'string', enum: ['create', 'update', 'delete'] };
  const spec = manager.types.schema;
  const changeInput = objectSchema({ changeSetId: id });
  const receipt = objectSchema({ changeSetId: id, state: { type: 'string', enum: ['applied', 'reverted'] } });
  const removedReceipt = objectSchema({ removed: { type: 'array', maxItems: DRAWING_LIMITS.maxOperations, items: id } }, ['removed']);
  const write = (toolId: string, direction: 'apply' | 'revert', existing = false): ToolDefinition => ({
    id: toolId, version: 1, effect: 'write',
    description: direction === 'revert' ? 'Revert only this session change set; reject intervening object edits.'
      : existing ? 'Apply a frozen proposal that may modify or delete existing user/old-session drawings. A paired MCP client or the built-in assistant executes this without a second per-operation approval; exact chart context and object version/CAS must still match. Do not change existing user content unless the user request clearly authorizes it.'
        : 'Apply a frozen proposal, limited to new objects or unchanged objects owned by this session.',
    inputSchema: changeInput, outputSchema: receipt,
    run: () => { throw new CapabilityError('write_requires_changeset'); },
    prepare: (input, execution) => manager.prepare((input as Record<string, JsonValue>).changeSetId as string, direction, execution, existing),
  });
  return [
    {
      id: 'tf.drawings.types', version: 1, effect: 'read',
      description: 'Discover registered drawing types, point counts and style schemas. Coordinates use time and price, not screen pixels.',
      inputSchema: emptyObjectSchema,
      outputSchema: { type: 'array', maxItems: DRAWING_LIMITS.maxTypes, items: objectSchema({
        type: { type: 'string', maxLength: 64 }, points: { type: 'integer', minimum: 1, maximum: DRAWING_LIMITS.maxPoints },
        maxPoints: { type: 'integer', minimum: 1, maximum: DRAWING_LIMITS.maxPoints },
        schemaJson: { type: 'string', maxLength: 64 * 1024 },
      }, ['type','points','schemaJson']) },
      run: () => manager.types.describe(),
    },
    {
      id: 'tf.drawings.list', version: 1, effect: 'read',
      description: 'Read supported drawing objects, opaque versions and session ownership. A version must accompany any update/delete proposal.',
      inputSchema: emptyObjectSchema,
      outputSchema: { type: 'array', maxItems: DRAWING_LIMITS.maxObjects, items: objectSchema({
        id, version, value: spec, ownership: { type: 'string', enum: ['session', 'user-or-other'] },
      }) },
      run: (_input, execution) => manager.list(execution),
    },
    {
      id: 'tf.drawings.propose', version: 1, effect: 'propose',
      description: 'Prepare an immutable batch without changing the chart. Create needs drawing; update needs id/version/drawing; delete needs id/version. Each object may occur once.',
      inputSchema: objectSchema({ operations: { type: 'array', maxItems: DRAWING_LIMITS.maxOperations, items:
        objectSchema({ op, id, version, drawing: spec }, ['op']) } }),
      outputSchema: objectSchema({
        changeSetId: id, state: { type: 'string', enum: ['proposed'] }, requiresExistingPermission: { type: 'boolean' },
        operations: { type: 'array', maxItems: DRAWING_LIMITS.maxOperations, items:
          objectSchema({ op, id, version, before: spec, after: spec }, ['op', 'id', 'version']) },
      }),
      run: (input, execution) => manager.propose(input, execution),
    },
    write('tf.drawings.apply', 'apply'),
    write('tf.drawings.apply_existing', 'apply', true),
    write('tf.drawings.revert', 'revert'),
    {
      id: 'tf.drawings.remove_owned', version: 1, effect: 'write',
      description: 'Delete drawing objects still owned by this AI session, even when an old changeSet is unavailable after a chart/timeframe change. Refuses user/other objects and objects edited since creation.',
      inputSchema: objectSchema({ ids: { type: 'array', maxItems: DRAWING_LIMITS.maxOperations, items: id } }, ['ids']),
      outputSchema: removedReceipt,
      run: () => { throw new CapabilityError('write_requires_changeset'); },
      prepare: (input, execution) => manager.prepareOwnedRemove((input as { ids: string[] }).ids, execution),
    },
  ];
}

/** Recovery is opt-in, separately authorized, and never restores session grants. */
export function createDrawingRecoveryTools(manager: DrawingChangeManager): readonly ToolDefinition[] {
  return [
    {
      id: 'tf.drawings.history', version: 1, effect: 'read',
      description: 'Read committed drawing receipts in this document. No pending operations or previous authorization is restored.',
      inputSchema: emptyObjectSchema,
      outputSchema: { type: 'array', maxItems: 64, items: objectSchema({
        changeSetId: { type: 'string', maxLength: 128 }, state: { type: 'string', enum: ['applied', 'reverted'] },
        createdAtMs: { type: 'integer', minimum: 0 }, objectCount: { type: 'integer', minimum: 1, maximum: 32 },
      }) },
      run: (_input, execution) => manager.history(execution),
    },
    {
      id: 'tf.drawings.revert_saved', version: 1, effect: 'write',
      description: 'Undo a saved receipt with NEW user authorization. Reject any intervening native object edit.',
      inputSchema: objectSchema({ changeSetId: { type: 'string', maxLength: 128 } }),
      outputSchema: objectSchema({ changeSetId: { type: 'string', maxLength: 128 }, state: { type: 'string', enum: ['reverted'] } }),
      run: () => { throw new CapabilityError('write_requires_changeset'); },
      prepare: (input, execution) => manager.prepareSavedRevert((input as Record<string, JsonValue>).changeSetId as string, execution),
    },
  ];
}
