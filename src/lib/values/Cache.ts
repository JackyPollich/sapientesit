import { composeObject, entries } from "alcalzone-shared/objects";
import { isArray, isObject } from "alcalzone-shared/typeguards";
import { ValueID } from "../node/ValueDB";
import { JSONObject } from "../util/misc";
import { ValueMetadata } from "./Metadata";

// export type SerializableValue = number | string | boolean | Map<string | number, any> | JSONObject;
type SerializedValue = number | string | boolean | JSONObject | undefined;

export interface CacheValue
	extends Pick<ValueID, "endpoint" | "property" | "propertyKey"> {
	value: SerializedValue;
}

export interface CacheMetadata
	extends Pick<ValueID, "endpoint" | "property" | "propertyKey"> {
	metadata: ValueMetadata;
}

const SPECIAL_TYPE_KEY = "$$type$$";

/** Serializes a value so it can be stored in a JSON object (and later on disk) */
export function serializeCacheValue(value: unknown): SerializedValue {
	if (value instanceof Map) {
		// We mark maps with a special key, so they can be detected by the deserialization routine
		return {
			// wotan-disable-next-line no-duplicate-spread-property
			...composeObject(
				[...value.entries()].map(([k, v]) => [
					k,
					serializeCacheValue(v),
				]),
			),
			[SPECIAL_TYPE_KEY]: "map",
		};
	} else if (
		typeof value === "number" ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		isObject(value) ||
		isArray(value)
	) {
		return value;
	}
}

/** Deserializes a value that was serialized by serializeCacheValue */
export function deserializeCacheValue(value: SerializedValue): unknown {
	// Convert objects which used to be a map back to a Map
	if (
		isObject(value) &&
		(value as Record<any, any>)[SPECIAL_TYPE_KEY] === "map"
	) {
		const { [SPECIAL_TYPE_KEY]: _, ...rest } = value as Record<any, any>;
		return new Map<unknown, unknown>(
			entries(rest)
				// We assume that all keys that resemble a number should be a number
				.map(([k, v]) => [/^\d+$/.test(k) ? parseInt(k, 10) : k, v])
				// recursively deserialize the value
				.map(([k, v]) => [k, deserializeCacheValue(v)]),
		);
	}
	return value;
}
