type Handler<Payload> = (payload: Payload) => void;

export type Emitter<Events> = {
	on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void;

	emit<K extends keyof Events>(type: K, payload: Events[K]): void;

	clear(): void;
};

export function createEmitter<Events>(): Emitter<Events> {
	const handlers = new Map<keyof Events, Set<Handler<any>>>();

	return {
		on(type, handler) {
			let set = handlers.get(type);
			if (!set) {
				set = new Set();
				handlers.set(type, set);
			}
			set.add(handler as Handler<any>);

			return () => {
				set?.delete(handler as Handler<any>);
				if (!set?.size) handlers.delete(type);
			};
		},

		emit(type, payload) {
			const set = handlers.get(type);
			if (!set) return;
			for (const handler of Array.from(set)) {
				handler(payload);
			}
		},

		clear() {
			handlers.clear();
		},
	};
}
