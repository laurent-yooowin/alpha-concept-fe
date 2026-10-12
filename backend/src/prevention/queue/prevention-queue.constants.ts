export const PREVENTION_QUEUE = Symbol('PREVENTION_QUEUE');
export const PREVENTION_REDIS = Symbol('PREVENTION_REDIS');
export const PREVENTION_GROUP_QUEUE = Symbol('PREVENTION_GROUP_QUEUE');
export const PREVENTION_GROUP_QUEUE_NAME = 'prevention-group-llm';
/** Low-concurrency lane for scheduler/admin/Budget bulk work. */
export const PREVENTION_BULK_QUEUE = Symbol('PREVENTION_BULK_QUEUE');
export const PREVENTION_BULK_QUEUE_NAME = 'prevention-bulk';
