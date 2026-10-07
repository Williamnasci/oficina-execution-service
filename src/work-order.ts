export interface WorkOrder { orderId: string; status: 'DIAGNOSING' | 'DIAGNOSED' | 'QUEUED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED'; diagnosis?: string; paymentId?: string; }

export function startDiagnosis(orderId: string): WorkOrder {
  if (!orderId.trim()) throw new Error('Order id is required');
  return { orderId, status: 'DIAGNOSING' };
}

export function diagnose(order: WorkOrder, diagnosis: string): WorkOrder {
  if (order.status !== 'DIAGNOSING' || !diagnosis.trim()) throw new Error('Invalid diagnosis');
  return { ...order, status: 'DIAGNOSED', diagnosis: diagnosis.trim() };
}

export function queue(order: WorkOrder, paymentId: string): WorkOrder {
  if (!paymentId.trim()) throw new Error('Verified payment is required');
  if (order.status === 'QUEUED' && order.paymentId === paymentId) return order;
  if (order.status !== 'DIAGNOSED') throw new Error('Order is not ready for queue');
  return { ...order, status: 'QUEUED', paymentId };
}

export function startRepair(order: WorkOrder): WorkOrder {
  if (order.status === 'IN_PROGRESS') return order;
  if (order.status !== 'QUEUED') throw new Error('Order is not queued');
  return { ...order, status: 'IN_PROGRESS' };
}

export function finishRepair(order: WorkOrder): WorkOrder {
  if (order.status !== 'IN_PROGRESS') throw new Error('Order is not in progress');
  return { ...order, status: 'FINISHED' };
}

export function cancel(order: WorkOrder): WorkOrder {
  if (['IN_PROGRESS', 'FINISHED'].includes(order.status)) throw new Error('Physical repair requires manual intervention');
  if (order.status === 'CANCELLED') return order;
  return { ...order, status: 'CANCELLED' };
}

/** Persist even if StartDiagnosis has not arrived: tombstone fences delayed messages. */
export function cancellationTombstone(orderId: string): WorkOrder {
  if (!orderId.trim()) throw new Error('Order id is required');
  return { orderId, status: 'CANCELLED' };
}
