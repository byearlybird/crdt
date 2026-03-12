import { expect, test } from "bun:test";
import { type Clock, createClock } from "#api/clock";
import { makeDataFromPOJO, makeDoc, makePOJO, patchDoc } from "#crdt/document";
import type { Doc } from "#crdt/types";
import { takeAtomHashes, takeDiffedData } from "#sync/diff";

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

type Person = {
	id: string;
	name: string;
	age: number;
	email: string;
	address: {
		street: string;
		city: string;
		state: string;
		zip: string;
	};
};

function makePersonDocs() {
	const person: Person = {
		id: "1",
		name: "John Doe",
		age: 30,
		email: "john.doe@example.com",
		address: {
			street: "123 Main St",
			city: "Anytown",
			state: "CA",
			zip: "12345",
		},
	};

	const stamp = createClock("original").tick();

	const data = makeDataFromPOJO(person, stamp);
	const localDoc = makeDoc(data);
	const remoteDoc = makeDoc(data);

	return { localDoc, remoteDoc, person };
}

function applyPatch(doc: Doc, clock: Clock, updates: DeepPartial<Person>) {
	const data = makeDataFromPOJO(updates, clock.tick());
	patchDoc(doc, data);
}

test("end-to-end in-memory", () => {
	const { localDoc, remoteDoc, person } = makePersonDocs();

	const localClock = createClock("local");
	const remoteClock = createClock("remote");

	const localUpdateOne: DeepPartial<Person> = {
		age: 31,
	};

	applyPatch(localDoc, localClock, localUpdateOne);

	const localUpdateTwo: DeepPartial<Person> = {
		email: "john.doe+local@example.com",
	};

	applyPatch(localDoc, localClock, localUpdateTwo);

	const remoteUpdateOne: DeepPartial<Person> = {
		age: 26,
	};

	applyPatch(remoteDoc, remoteClock, remoteUpdateOne);

	const remoteUpdateTwo: DeepPartial<Person> = {
		address: {
			street: "456 Main St",
		},
	};

	applyPatch(remoteDoc, remoteClock, remoteUpdateTwo);

	expect(localDoc["~h"]).not.toEqual(remoteDoc["~h"]);

	// "Pull" remote activity into local
	const localAtomHashes = takeAtomHashes(localDoc); // take the hashes of the local atoms and send them to the remote
	const diffRemoteData = takeDiffedData(remoteDoc, localAtomHashes); // take the diffed data from the remote to share with local
	patchDoc(localDoc, diffRemoteData); // patch the local doc with the diffed data from the remote

	expect(makePOJO<Person>(localDoc)).toEqual({
		...person,
		...localUpdateOne,
		...localUpdateTwo,
		...remoteUpdateOne,
		address: {
			...person.address,
			...remoteUpdateTwo.address,
		},
	});
});
