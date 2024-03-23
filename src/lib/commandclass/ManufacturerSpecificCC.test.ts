import { Driver, ZWaveNode } from "../..";
import { createEmptyMockDriver } from "../../../test/mocks";
import { assertCC } from "../../../test/util";
import { loadManufacturers } from "../config/Manufacturers";
import { IDriver } from "../driver/IDriver";
import { CommandClass, getCommandClass } from "./CommandClass";
import { CommandClasses } from "./CommandClasses";
import {
	ManufacturerSpecificCC,
	ManufacturerSpecificCCGet,
} from "./ManufacturerSpecificCC";

const fakeDriver = (createEmptyMockDriver() as unknown) as IDriver;

describe("lib/commandclass/ManufacturerSpecificCC => ", () => {
	const cc = new ManufacturerSpecificCCGet(fakeDriver, { nodeId: 2 });
	let serialized: Buffer;

	it("should be a CommandClass", () => {
		expect(cc).toBeInstanceOf(CommandClass);
	});
	it(`with command class "Manufacturer Specific"`, () => {
		expect(getCommandClass(cc)).toBe(
			CommandClasses["Manufacturer Specific"],
		);
	});

	it("should serialize correctly", () => {
		serialized = cc.serialize();
		expect(serialized).toEqual(Buffer.from("02027204", "hex"));
	});

	it("should deserialize correctly", () => {
		const deserialized = CommandClass.from(fakeDriver, serialized);
		expect(deserialized).toBeInstanceOf(ManufacturerSpecificCC);
		expect(deserialized.nodeId).toBe(cc.nodeId);
	});

	describe(`interview()`, () => {
		const fakeDriver = createEmptyMockDriver();
		const node = new ZWaveNode(2, (fakeDriver as unknown) as Driver);
		let cc: ManufacturerSpecificCC;

		function doInterview() {
			return cc.interview();
		}
		function resetSendMessageImplementation() {
			fakeDriver.sendMessage.mockImplementation(() =>
				Promise.resolve({ command: {} }),
			);
		}

		beforeAll(async () => {
			await loadManufacturers();
			resetSendMessageImplementation();
			fakeDriver.controller.nodes.set(node.id, node);
			node.addCC(CommandClasses["Manufacturer Specific"], {
				isSupported: true,
			});
			cc = node.createCCInstance(ManufacturerSpecificCC)!;
		});
		beforeEach(() => fakeDriver.sendMessage.mockClear());
		afterAll(() => {
			fakeDriver.sendMessage.mockImplementation(() => Promise.resolve());
		});

		it("should not send anything if the node is the controller", async () => {
			// Temporarily make this node the controller node
			fakeDriver.controller.ownNodeId = node.id;
			await doInterview();
			expect(fakeDriver.sendMessage).not.toBeCalled();
			fakeDriver.controller.ownNodeId = 1;
		});

		it("should send a ManufacturerSpecificCC.Get", async () => {
			fakeDriver.sendMessage.mockImplementation(() =>
				Promise.resolve({
					command: {
						manufacturerId: 0xffff,
						productType: 0x00,
						productId: 0x00,
					},
				}),
			);
			await doInterview();

			expect(fakeDriver.sendMessage).toBeCalled();

			assertCC(fakeDriver.sendMessage.mock.calls[0][0], {
				cc: ManufacturerSpecificCCGet,
				nodeId: node.id,
			});
		});
	});
});
