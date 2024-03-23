import { assertZWaveError } from "../../../test/util";
import { CommandClasses } from "../commandclass/CommandClasses";
import { ZWaveErrorCodes } from "../error/ZWaveError";
import { ValueMetadata } from "../values/Metadata";
import { ValueDB, ValueID } from "./ValueDB";

describe("lib/node/ValueDB => ", () => {
	let valueDB: ValueDB;
	const onValueAdded = jest.fn();
	const onValueUpdated = jest.fn();
	const onValueRemoved = jest.fn();
	const onMetadataUpdated = jest.fn();

	function createValueDB(): void {
		valueDB = new ValueDB()
			.on("value added", onValueAdded)
			.on("value updated", onValueUpdated)
			.on("value removed", onValueRemoved)
			.on("metadata updated", onMetadataUpdated);
	}

	beforeAll(() => createValueDB());

	describe("setValue() (first add)", () => {
		let cbArg: any;
		beforeAll(() => {
			valueDB.setValue(
				{
					commandClass: CommandClasses["Alarm Sensor"],
					endpoint: 4,
					property: "foo",
				},
				"bar",
			);
		});

		afterAll(() => {
			onValueAdded.mockClear();
			onValueUpdated.mockClear();
			onValueRemoved.mockClear();
		});

		it("should emit the value added event", () => {
			expect(onValueAdded).toBeCalled();
			cbArg = onValueAdded.mock.calls[0][0];
		});

		it("The callback arg should contain the CC", () => {
			expect(cbArg).toBeObject();
			expect(cbArg.commandClass).toBe(CommandClasses["Alarm Sensor"]);
		});

		it("The callback arg should contain the endpoint", () => {
			expect(cbArg.endpoint).toBe(4);
		});

		it("The callback arg should contain the property name", () => {
			expect(cbArg.property).toBe("foo");
		});

		it("The callback arg should contain the new value", () => {
			expect(cbArg.newValue).toBe("bar");
		});
	});

	describe("setValue() (consecutive adds)", () => {
		let cbArg: any;
		beforeAll(() => {
			const valueId = {
				commandClass: CommandClasses["Wake Up"],
				endpoint: 0,
				property: "prop",
			};
			valueDB.setValue(valueId, "foo");
			valueDB.setValue(valueId, "bar");
		});

		afterAll(() => {
			onValueAdded.mockClear();
			onValueUpdated.mockClear();
			onValueRemoved.mockClear();
		});

		it("should emit the value updated event", () => {
			expect(onValueUpdated).toBeCalled();
			cbArg = onValueUpdated.mock.calls[0][0];
		});

		it("The callback arg should contain the CC", () => {
			expect(cbArg).toBeObject();
			expect(cbArg.commandClass).toBe(CommandClasses["Wake Up"]);
		});

		it("The callback arg should contain the endpoint", () => {
			expect(cbArg.endpoint).toBe(0);
		});

		it("The callback arg should contain the property name", () => {
			expect(cbArg.property).toBe("prop");
		});

		it("The callback arg should contain the previous value", () => {
			expect(cbArg.prevValue).toBe("foo");
		});

		it("The callback arg should contain the new value", () => {
			expect(cbArg.newValue).toBe("bar");
		});
	});

	describe("setValue()/removeValue() (with the noEvent parameter set to true)", () => {
		beforeAll(() => {
			valueDB.setValue(
				{
					commandClass: CommandClasses["Alarm Sensor"],
					endpoint: 4,
					property: "foo",
				},
				"bar",
				{ noEvent: true },
			);
			valueDB.setValue(
				{
					commandClass: CommandClasses["Alarm Sensor"],
					endpoint: 4,
					property: "foo",
				},
				"baz",
				{ noEvent: true },
			);
			valueDB.removeValue(
				{
					commandClass: CommandClasses["Alarm Sensor"],
					endpoint: 4,
					property: "foo",
				},
				{ noEvent: true },
			);
		});

		afterAll(() => {
			onValueAdded.mockClear();
			onValueUpdated.mockClear();
			onValueRemoved.mockClear();
		});

		it("should not emit any events", () => {
			expect(onValueAdded).not.toBeCalled();
			expect(onValueUpdated).not.toBeCalled();
			expect(onValueRemoved).not.toBeCalled();
		});
	});

	describe("values with a property key", () => {
		const cc = CommandClasses["Wake Up"];

		beforeAll(() => {
			valueDB.setValue(
				{
					commandClass: cc,
					endpoint: 0,
					property: "prop",
					propertyKey: "foo",
				},
				1,
			);
			valueDB.setValue(
				{
					commandClass: cc,
					endpoint: 0,
					property: "prop",
					propertyKey: "bar",
				},
				2,
			);
		});

		afterAll(() => {
			onValueAdded.mockClear();
			onValueUpdated.mockClear();
			onValueRemoved.mockClear();
		});

		it("getValue()/setValue() should treat different property keys as distinct values", () => {
			expect(
				valueDB.getValue({
					commandClass: cc,
					endpoint: 0,
					property: "prop",
					propertyKey: "foo",
				}),
			).toBe(1);
			expect(
				valueDB.getValue({
					commandClass: cc,
					endpoint: 0,
					property: "prop",
					propertyKey: "bar",
				}),
			).toBe(2);
		});

		it("the value added callback should have been called for each added value", () => {
			expect(onValueAdded).toBeCalled();
			const getArg = (call: number) => onValueAdded.mock.calls[call][0];
			expect(getArg(0).propertyKey).toBe("foo");
			expect(getArg(1).propertyKey).toBe("bar");
		});

		it("after clearing the value DB, the values should all be removed", () => {
			valueDB.clear();
			expect(
				valueDB.getValue({
					commandClass: cc,
					endpoint: 0,
					property: "prop",
					propertyKey: "foo",
				}),
			).toBeUndefined();
			expect(
				valueDB.getValue({
					commandClass: cc,
					endpoint: 0,
					property: "prop",
					propertyKey: "bar",
				}),
			).toBeUndefined();
		});
	});

	describe("removeValue()", () => {
		let cbArg: any;
		beforeAll(() => {
			valueDB.setValue(
				{
					commandClass: CommandClasses["Alarm Sensor"],
					endpoint: 1,
					property: "bar",
				},
				"foo",
			);
			valueDB.removeValue({
				commandClass: CommandClasses["Alarm Sensor"],
				endpoint: 1,
				property: "bar",
			});
		});

		afterAll(() => {
			onValueAdded.mockClear();
			onValueUpdated.mockClear();
			onValueRemoved.mockClear();
		});

		it("should emit the value removed event", () => {
			expect(onValueRemoved).toBeCalled();
			cbArg = onValueRemoved.mock.calls[0][0];
		});

		it("The callback arg should contain the CC", () => {
			expect(cbArg).toBeObject();
			expect(cbArg.commandClass).toBe(CommandClasses["Alarm Sensor"]);
		});

		it("The callback arg should contain the endpoint", () => {
			expect(cbArg.endpoint).toBe(1);
		});

		it("The callback arg should contain the property name", () => {
			expect(cbArg.property).toBe("bar");
		});

		it("The callback arg should contain the previous value", () => {
			expect(cbArg.prevValue).toBe("foo");
		});

		it("If the value was not in the DB, the value removed event should not be emitted", () => {
			onValueRemoved.mockClear();
			valueDB.removeValue({
				commandClass: CommandClasses["Basic Tariff Information"],
				endpoint: 9,
				property: "test",
			});
			expect(onValueRemoved).not.toBeCalled();
		});

		it("should return true if a value was removed, false otherwise", () => {
			const retValNotFound = valueDB.removeValue({
				commandClass: CommandClasses["Basic Tariff Information"],
				endpoint: 9,
				property: "test",
			});
			expect(retValNotFound).toBeFalse();

			valueDB.setValue(
				{
					commandClass: CommandClasses["Basic Tariff Information"],
					endpoint: 0,
					property: "test",
				},
				"value",
			);
			const retValFound = valueDB.removeValue({
				commandClass: CommandClasses["Basic Tariff Information"],
				endpoint: 0,
				property: "test",
			});
			expect(retValFound).toBeTrue();
		});

		it("After removing a value, getValue should return undefined", () => {
			const actual = valueDB.getValue({
				commandClass: CommandClasses["Alarm Sensor"],
				endpoint: 1,
				property: "bar",
			});
			expect(actual).toBeUndefined();
		});
	});

	describe("clear()", () => {
		let cbArgs: any[];
		const valueId1 = {
			commandClass: CommandClasses["Alarm Sensor"],
			endpoint: 1,
			property: "bar",
		};
		const valueId2 = {
			commandClass: CommandClasses.Battery,
			endpoint: 2,
			property: "prop",
		};
		beforeAll(() => {
			createValueDB();
			valueDB.setValue(valueId1, "foo");
			valueDB.setValue(valueId2, "bar");
			valueDB.clear();
		});

		afterAll(() => {
			onValueAdded.mockClear();
			onValueUpdated.mockClear();
			onValueRemoved.mockClear();
		});

		it("should emit the value removed event for all stored values", () => {
			expect(onValueRemoved).toBeCalledTimes(2);
			cbArgs = onValueRemoved.mock.calls.map(args => args[0]);
		});

		it("The callback should contain the removed values", () => {
			expect(cbArgs[0]).toBeObject();
			expect(cbArgs[0].prevValue).toBe("foo");
			expect(cbArgs[1]).toBeObject();
			expect(cbArgs[1].prevValue).toBe("bar");
		});

		it("After clearing, getValue should return undefined", () => {
			let actual: unknown;
			actual = valueDB.getValue(valueId1);
			expect(actual).toBeUndefined();

			actual = valueDB.setValue(valueId2, "bar");
			expect(actual).toBeUndefined();
		});
	});

	describe("getValue() / getValues()", () => {
		beforeEach(() => createValueDB());

		it("getValue() should return the value stored for the same combination of CC, endpoint and property", () => {
			const tests = [
				{
					commandClass: CommandClasses.Basic,
					endpoint: 0,
					property: "foo",
					value: "1",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 2,
					property: "foo",
					value: "2",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 0,
					property: "FOO",
					value: "3",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 2,
					property: "FOO",
					value: "4",
				},
			];

			for (const { value, ...valueId } of tests) {
				valueDB.setValue(valueId, value);
			}
			for (const { value, ...valueId } of tests) {
				expect(valueDB.getValue(valueId)).toBe(value);
			}
		});

		it("getValues() should return all values stored for the given CC", () => {
			const values = [
				{
					commandClass: CommandClasses.Basic,
					endpoint: 0,
					property: "foo",
					value: "1",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 2,
					property: "foo",
					value: "2",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 0,
					property: "FOO",
					value: "3",
				},
				{
					commandClass: CommandClasses.Battery,
					endpoint: 2,
					property: "FOO",
					value: "4",
				},
			];
			const requestedCC = CommandClasses.Basic;
			const expected = values.filter(t => t.commandClass === requestedCC);

			for (const { value, ...valueId } of values) {
				valueDB.setValue(valueId, value);
			}

			const actual = valueDB.getValues(requestedCC);
			expect(actual).toHaveLength(expected.length);
			expect(actual).toContainAllValues(expected);
		});
	});

	describe("hasValue()", () => {
		beforeEach(() => createValueDB());

		it("should return false if no value is stored for the same combination of CC, endpoint and property", () => {
			const tests = [
				{
					commandClass: CommandClasses.Basic,
					endpoint: 0,
					property: "foo",
					value: "1",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 2,
					property: "foo",
					value: "2",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 0,
					property: "FOO",
					value: "3",
				},
				{
					commandClass: CommandClasses.Basic,
					endpoint: 2,
					property: "FOO",
					value: "4",
				},
			];

			for (const { value, ...valueId } of tests) {
				expect(valueDB.hasValue(valueId)).toBeFalse();
				valueDB.setValue(valueId, value);
				expect(valueDB.hasValue(valueId)).toBeTrue();
			}
		});
	});

	describe("Metadata", () => {
		beforeEach(() => createValueDB());

		it("is assigned to a specific combination of endpoint, property name (and property key)", () => {
			const valueId: ValueID = {
				commandClass: 1,
				endpoint: 2,
				property: "3",
			};
			valueDB.setMetadata(valueId, ValueMetadata.Any);
			expect(valueDB.hasMetadata(valueId)).toBeTrue();
			expect(
				valueDB.hasMetadata({ ...valueId, propertyKey: 4 }),
			).toBeFalse();
			expect(valueDB.getMetadata(valueId)).toBe(ValueMetadata.Any);
			expect(
				valueDB.getMetadata({ ...valueId, propertyKey: 4 }),
			).toBeUndefined();
		});

		it("is cleared together with the values", () => {
			const valueId: ValueID = {
				commandClass: 1,
				endpoint: 2,
				property: "3",
			};
			valueDB.setMetadata(valueId, ValueMetadata.Any);
			valueDB.clear();
			expect(valueDB.hasMetadata(valueId)).toBeFalse();
		});

		describe("getAllMetadata()", () => {
			it("returns all metadata for a given CC", () => {
				expect(valueDB.getAllMetadata(1)).toHaveLength(0);

				valueDB.setMetadata(
					{
						commandClass: 1,
						endpoint: 2,
						property: "3",
					},
					ValueMetadata.Any,
				);
				expect(valueDB.getAllMetadata(1)).toHaveLength(1);

				valueDB.setMetadata(
					{
						commandClass: 5,
						endpoint: 2,
						property: "3",
					},
					ValueMetadata.Any,
				);
				expect(valueDB.getAllMetadata(1)).toHaveLength(1);
				expect(valueDB.getAllMetadata(5)).toHaveLength(1);

				valueDB.setMetadata(
					{
						commandClass: 5,
						endpoint: 2,
						property: "5",
					},
					ValueMetadata.Any,
				);
				expect(valueDB.getAllMetadata(1)).toHaveLength(1);
				expect(valueDB.getAllMetadata(5)).toHaveLength(2);
			});
		});

		describe("updating dynamic metadata", () => {
			let cbArg: any;
			beforeAll(() => {
				valueDB.setMetadata(
					{
						commandClass: 1,
						endpoint: 2,
						property: "3",
					},
					ValueMetadata.Any,
				);
			});

			afterAll(() => {
				onMetadataUpdated.mockClear();
			});

			it(`should emit the "metadata updated" event`, () => {
				expect(onMetadataUpdated).toBeCalled();
				cbArg = onMetadataUpdated.mock.calls[0][0];
			});

			it("The callback arg should contain the CC", () => {
				expect(cbArg).toBeObject();
				expect(cbArg.commandClass).toBe(1);
			});

			it("The callback arg should contain the endpoint", () => {
				expect(cbArg.endpoint).toBe(2);
			});

			it("The callback arg should contain the property", () => {
				expect(cbArg.property).toBe("3");
			});

			it("The callback arg should contain the new metadata", () => {
				expect(cbArg.metadata).toBe(ValueMetadata.Any);
			});
		});
	});

	describe("invalid value IDs should cause an error to be thrown", () => {
		const invalidValueIDs = [
			// missing required properties
			{ commandClass: undefined, property: "test" },
			{ commandClass: 1, property: undefined },
			// wrong type
			{ commandClass: "1", property: 5, propertyKey: 7, endpoint: 1 },
			{ commandClass: 1, property: true, propertyKey: 7, endpoint: 1 },
			{ commandClass: 1, property: 5, propertyKey: false, endpoint: 1 },
			{ commandClass: 1, property: 5, propertyKey: 7, endpoint: "5" },
		];
		it("getValue()", () => {
			for (const valueId of invalidValueIDs) {
				assertZWaveError(() => valueDB.getValue(valueId as any), {
					errorCode: ZWaveErrorCodes.Argument_Invalid,
				});
			}
		});

		it("setValue()", () => {
			for (const valueId of invalidValueIDs) {
				assertZWaveError(() => valueDB.setValue(valueId as any, 0), {
					errorCode: ZWaveErrorCodes.Argument_Invalid,
				});
			}
		});

		it("hasValue()", () => {
			for (const valueId of invalidValueIDs) {
				assertZWaveError(() => valueDB.hasValue(valueId as any), {
					errorCode: ZWaveErrorCodes.Argument_Invalid,
				});
			}
		});

		it("removeValue()", () => {
			for (const valueId of invalidValueIDs) {
				assertZWaveError(() => valueDB.removeValue(valueId as any), {
					errorCode: ZWaveErrorCodes.Argument_Invalid,
				});
			}
		});

		it("getMetadata()", () => {
			for (const valueId of invalidValueIDs) {
				assertZWaveError(() => valueDB.getMetadata(valueId as any), {
					errorCode: ZWaveErrorCodes.Argument_Invalid,
				});
			}
		});

		it("setMetadata()", () => {
			for (const valueId of invalidValueIDs) {
				assertZWaveError(
					() => valueDB.setMetadata(valueId as any, {} as any),
					{
						errorCode: ZWaveErrorCodes.Argument_Invalid,
					},
				);
			}
		});

		it("hasMetadata()", () => {
			for (const valueId of invalidValueIDs) {
				assertZWaveError(() => valueDB.hasMetadata(valueId as any), {
					errorCode: ZWaveErrorCodes.Argument_Invalid,
				});
			}
		});
	});

	describe(`invalid value IDs should be ignored by the setXYZ methods when the "noThrow" parameter is true`, () => {
		const invalidValueIDs = [
			// missing required properties
			{ commandClass: undefined, property: "test" },
			{ commandClass: 1, property: undefined },
			// wrong type
			{ commandClass: "1", property: 5, propertyKey: 7, endpoint: 1 },
			{ commandClass: 1, property: true, propertyKey: 7, endpoint: 1 },
			{ commandClass: 1, property: 5, propertyKey: false, endpoint: 1 },
			{ commandClass: 1, property: 5, propertyKey: 7, endpoint: "5" },
		];

		it("setValue()", () => {
			for (const valueId of invalidValueIDs) {
				expect(() =>
					valueDB.setValue(valueId as any, 0, { noThrow: true }),
				).not.toThrow();
			}
		});

		it("setMetadata()", () => {
			for (const valueId of invalidValueIDs) {
				expect(() =>
					valueDB.setMetadata(valueId as any, {} as any, {
						noThrow: true,
					}),
				).not.toThrow();
			}
		});
	});
});
