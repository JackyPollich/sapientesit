import { createEmptyMockDriver } from "../../../test/mocks";
import { assertCC, assertZWaveError } from "../../../test/util";
import { BasicCC, BasicCommand } from "../commandclass/BasicCC";
import { CommandClassInfo } from "../commandclass/CommandClass";
import { CommandClasses } from "../commandclass/CommandClasses";
import { NoOperationCC } from "../commandclass/NoOperationCC";
import { WakeUpCC, WakeUpCommand } from "../commandclass/WakeUpCC";
import {
	ApplicationUpdateRequest,
	ApplicationUpdateTypes,
} from "../controller/ApplicationUpdateRequest";
import {
	GetNodeProtocolInfoRequest,
	GetNodeProtocolInfoResponse,
} from "../controller/GetNodeProtocolInfoMessages";
import {
	GetRoutingInfoRequest,
	GetRoutingInfoResponse,
} from "../controller/GetRoutingInfoMessages";
import { SendDataRequest } from "../controller/SendDataMessages";
import { Driver } from "../driver/Driver";
import { ZWaveErrorCodes } from "../error/ZWaveError";
import { ValueMetadata } from "../values/Metadata";
import {
	BasicDeviceClasses,
	DeviceClass,
	GenericDeviceClass,
	GenericDeviceClasses,
	SpecificDeviceClass,
} from "./DeviceClass";
import { InterviewStage, NodeStatus } from "./INode";
import { ZWaveNode, ZWaveNodeEvents } from "./Node";
import { NodeUpdatePayload } from "./NodeInfo";
import { RequestNodeInfoRequest } from "./RequestNodeInfoMessages";
import { ValueDB, ValueID } from "./ValueDB";

/** This is an ugly hack to be able to test the private methods without resorting to @internal */
class TestNode extends ZWaveNode {
	public async queryProtocolInfo(): Promise<void> {
		return super.queryProtocolInfo();
	}
	public async ping(): Promise<boolean> {
		return super.ping();
	}
	public async queryNodeInfo(): Promise<void> {
		return super.queryNodeInfo();
	}
	public async interviewCCs(): Promise<void> {
		return super.interviewCCs();
	}
	// public async queryManufacturerSpecific(): Promise<void> {
	// 	return super.queryManufacturerSpecific();
	// }
	// public async queryCCVersions(): Promise<void> {
	// 	return super.queryCCVersions();
	// }
	// public async queryEndpoints(): Promise<void> {
	// 	return super.queryEndpoints();
	// }
	// public async configureWakeup(): Promise<void> {
	// 	return super.configureWakeup();
	// }
	// public async requestStaticValues(): Promise<void> {
	// 	return super.requestStaticValues();
	// }
	public async queryNeighbors(): Promise<void> {
		return super.queryNeighbors();
	}
	public get implementedCommandClasses(): Map<
		CommandClasses,
		CommandClassInfo
	> {
		return super.implementedCommandClasses as any;
	}
}

describe("lib/node/Node", () => {
	describe("constructor", () => {
		const fakeDriver = (createEmptyMockDriver() as unknown) as Driver;
		it("stores the given Node ID", () => {
			expect(new ZWaveNode(1, fakeDriver).id).toBe(1);
			expect(new ZWaveNode(3, fakeDriver).id).toBe(3);
		});

		it("stores the given device class", () => {
			function makeNode(cls: DeviceClass): ZWaveNode {
				return new ZWaveNode(1, fakeDriver, cls);
			}

			expect(makeNode(undefined as any).deviceClass).toBeUndefined();

			const devCls = new DeviceClass(
				BasicDeviceClasses.Controller,
				GenericDeviceClass.get(GenericDeviceClasses["Alarm Sensor"]),
				SpecificDeviceClass.get(
					GenericDeviceClasses["Alarm Sensor"],
					0x02,
				),
			);
			expect(makeNode(devCls).deviceClass).toBe(devCls);
		});

		it("remembers all given command classes", () => {
			function makeNode(
				supportedCCs: CommandClasses[] = [],
				controlledCCs: CommandClasses[] = [],
			): ZWaveNode {
				return new ZWaveNode(
					1,
					fakeDriver,
					undefined,
					supportedCCs,
					controlledCCs,
				);
			}

			const tests: {
				supported: CommandClasses[];
				controlled: CommandClasses[];
			}[] = [
				{
					supported: [CommandClasses["Anti-theft"]],
					controlled: [CommandClasses.Basic],
				},
			];
			for (const { supported, controlled } of tests) {
				const node = makeNode(supported, controlled);

				for (const supp of supported) {
					expect(node.supportsCC(supp)).toBeTrue();
				}
				for (const ctrl of controlled) {
					expect(node.controlsCC(ctrl)).toBeTrue();
				}
			}
		});

		it("initializes the node's value DB", () => {
			const node = new ZWaveNode(1, fakeDriver);
			expect(node.valueDB).toBeInstanceOf(ValueDB);
		});
	});

	describe("interview()", () => {
		const fakeDriver = createEmptyMockDriver();
		const node = new TestNode(2, (fakeDriver as unknown) as Driver);
		fakeDriver.controller.nodes.set(node.id, node);

		// We might need to persist the node state between stages, so
		// it shouldn't be created for each test

		describe(`queryProtocolInfo()`, () => {
			let expected: GetNodeProtocolInfoResponse;

			beforeAll(() => {
				fakeDriver.sendMessage.mockClear();

				expected = {
					isListening: true,
					isFrequentListening: false,
					isRouting: true,
					maxBaudRate: 100000,
					isSecure: false,
					version: 3,
					isBeaming: false,
					deviceClass: new DeviceClass(
						BasicDeviceClasses.Controller,
						GenericDeviceClass.get(
							GenericDeviceClasses["Alarm Sensor"],
						),
						SpecificDeviceClass.get(
							GenericDeviceClasses["Alarm Sensor"],
							0x02,
						),
					),
				} as GetNodeProtocolInfoResponse;

				fakeDriver.sendMessage.mockResolvedValue(expected);
			});

			it("should send a GetNodeProtocolInfoRequest", async () => {
				await node.queryProtocolInfo();

				expect(fakeDriver.sendMessage).toBeCalled();
				const request: GetNodeProtocolInfoRequest =
					fakeDriver.sendMessage.mock.calls[0][0];
				expect(request).toBeInstanceOf(GetNodeProtocolInfoRequest);
				expect(request.nodeId).toBe(node.id);
			});

			it("should remember all received information", () => {
				for (const prop of Object.keys(
					expected,
				) as (keyof typeof expected)[]) {
					expect((node as any)[prop]).toBe(expected[prop]);
				}
			});

			it("should set the interview stage to ProtocolInfo", () => {
				expect(node.interviewStage).toBe(InterviewStage.ProtocolInfo);
			});

			it("if the node is a sleeping device, assume that it is awake", async () => {
				for (const {
					isListening,
					isFrequentListening,
					supportsWakeup,
				} of [
					// Test 1-3: not sleeping
					{
						isListening: true,
						isFrequentListening: true,
						supportsWakeup: false,
					},
					{
						isListening: false,
						isFrequentListening: true,
						supportsWakeup: false,
					},
					{
						isListening: true,
						isFrequentListening: false,
						supportsWakeup: false,
					},
					// Test 4: sleeping
					{
						isListening: false,
						isFrequentListening: false,
						supportsWakeup: true,
					},
				]) {
					Object.assign(expected, {
						isListening,
						isFrequentListening,
					});
					await node.queryProtocolInfo();

					expect(node.isAwake()).toBeTrue();
					expect(node.supportsCC(CommandClasses["Wake Up"])).toBe(
						supportsWakeup,
					);
				}
			});
		});

		describe(`ping()`, () => {
			beforeAll(() =>
				fakeDriver.sendMessage.mockImplementation(() =>
					Promise.resolve(),
				),
			);
			beforeEach(() => fakeDriver.sendMessage.mockClear());

			it(`should not change the current interview stage`, async () => {
				node.interviewStage = InterviewStage.OverwriteConfig;
				await node.ping();
				expect(node.interviewStage).toBe(
					InterviewStage.OverwriteConfig,
				);
			});

			it("should not send anything if the node is the controller", async () => {
				// Temporarily make this node the controller node
				fakeDriver.controller.ownNodeId = node.id;
				await node.ping();
				expect(fakeDriver.sendMessage).not.toBeCalled();
				fakeDriver.controller.ownNodeId = 1;
			});

			it("should send a NoOperation CC and wait for the response", async () => {
				await node.ping();

				expect(fakeDriver.sendMessage).toBeCalled();
				const request: SendDataRequest =
					fakeDriver.sendMessage.mock.calls[0][0];
				expect(request).toBeInstanceOf(SendDataRequest);
				expect(request.command).toBeInstanceOf(NoOperationCC);
				expect(request.getNodeId()).toBe(node.id);
			});
		});

		describe(`queryNodeInfo()`, () => {
			beforeAll(() =>
				fakeDriver.sendMessage.mockImplementation(() =>
					Promise.resolve(),
				),
			);
			beforeEach(() => fakeDriver.sendMessage.mockClear());

			it(`should set the interview stage to "NodeInfo"`, async () => {
				await node.queryNodeInfo();
				expect(node.interviewStage).toBe(InterviewStage.NodeInfo);
			});

			it("should not send anything if the node is the controller", async () => {
				// Temporarily make this node the controller node
				fakeDriver.controller.ownNodeId = node.id;
				await node.queryNodeInfo();
				expect(fakeDriver.sendMessage).not.toBeCalled();
				fakeDriver.controller.ownNodeId = 1;
			});

			it("should send a RequestNodeInfoRequest with the node's ID", async () => {
				await node.queryNodeInfo();
				expect(fakeDriver.sendMessage).toBeCalled();
				const request: RequestNodeInfoRequest =
					fakeDriver.sendMessage.mock.calls[0][0];
				expect(request).toBeInstanceOf(RequestNodeInfoRequest);
				expect(request.getNodeId()).toBe(node.id);
			});

			it.todo("Test the behavior when the request failed");

			// TODO: We need a real payload for this test
			it.skip("should update its node information with the received data and mark the node as awake", async () => {
				const nodeUpdate: NodeUpdatePayload = {
					basic: BasicDeviceClasses.Controller,
					generic: GenericDeviceClass.get(
						GenericDeviceClasses["Multilevel Sensor"],
					),
					specific: SpecificDeviceClass.get(
						GenericDeviceClasses["Multilevel Sensor"],
						0x02,
					),
					supportedCCs: [CommandClasses["User Code"]],
					controlledCCs: [CommandClasses["Window Covering"]],
					nodeId: 2,
				};
				const expected = new ApplicationUpdateRequest(
					fakeDriver as any,
					{} as any,
				);
				(expected as any)._updateType =
					ApplicationUpdateTypes.NodeInfo_Received;
				(expected as any)._nodeInformation = nodeUpdate;
				fakeDriver.sendMessage.mockResolvedValue(expected);

				await node.queryNodeInfo();
				for (const cc of nodeUpdate.supportedCCs) {
					expect(node.supportsCC(cc)).toBeTrue();
				}
				for (const cc of nodeUpdate.controlledCCs) {
					expect(node.controlsCC(cc)).toBeTrue();
				}

				expect(node.isAwake()).toBeTrue();
			});
		});

		describe(`interviewCCs()`, () => {
			beforeAll(() =>
				fakeDriver.sendMessage.mockImplementation(() =>
					Promise.resolve(),
				),
			);
			beforeEach(() => fakeDriver.sendMessage.mockClear());

			it(`should set the interview stage to "CommandClasses"`, async () => {
				await node.interviewCCs();
				expect(node.interviewStage).toBe(InterviewStage.CommandClasses);
			});

			it.todo("test that the CC interview methods are called");

			// it("should not send anything if the node is the controller", async () => {
			// 	// Temporarily make this node the controller node
			// 	fakeDriver.controller.ownNodeId = node.id;
			// 	await node.queryNodeInfo();
			// 	expect(fakeDriver.sendMessage).not.toBeCalled();
			// 	fakeDriver.controller.ownNodeId = 1;
			// });

			// it("should send a RequestNodeInfoRequest with the node's ID", async () => {
			// 	await node.queryNodeInfo();
			// 	expect(fakeDriver.sendMessage).toBeCalled();
			// 	const request: RequestNodeInfoRequest =
			// 		fakeDriver.sendMessage.mock.calls[0][0];
			// 	expect(request).toBeInstanceOf(RequestNodeInfoRequest);
			// 	expect(request.getNodeId()).toBe(node.id);
			// });
		});

		// describe(`queryEndpoints()`, () => {
		// 	beforeAll(() =>
		// 		fakeDriver.sendMessage.mockImplementation(() =>
		// 			Promise.resolve({ command: {} }),
		// 		),
		// 	);
		// 	beforeEach(() => fakeDriver.sendMessage.mockClear());
		// 	afterAll(() =>
		// 		fakeDriver.sendMessage.mockImplementation(() =>
		// 			Promise.resolve(),
		// 		),
		// 	);

		// 	it(`should set the interview stage to "Endpoints"`, async () => {
		// 		await node.queryEndpoints();
		// 		expect(node.interviewStage).toBe(InterviewStage.Endpoints);
		// 	});

		// 	it("should not send anything if the node does not support the Multi Channel CC", async () => {
		// 		node.addCC(CommandClasses["Multi Channel"], {
		// 			isSupported: false,
		// 			isControlled: false,
		// 		});
		// 		await node.queryEndpoints();
		// 		expect(fakeDriver.sendMessage).not.toBeCalled();
		// 	});

		// 	it("should send a MultiChannelCC.EndPointGet", async () => {
		// 		node.addCC(CommandClasses["Multi Channel"], {
		// 			isSupported: true,
		// 		});
		// 		await node.queryEndpoints();

		// 		expect(fakeDriver.sendMessage).toBeCalled();

		// 		assertCC(fakeDriver.sendMessage.mock.calls[0][0], {
		// 			cc: MultiChannelCC,
		// 			nodeId: node.id,
		// 			ccValues: {
		// 				ccCommand: MultiChannelCommand.EndPointGet,
		// 			},
		// 		});
		// 	});

		// 	it.todo("Test the behavior when the request failed");

		// 	it.todo("Test the behavior when the request succeeds");
		// });

		describe(`queryNeighbors()`, () => {
			let expected: GetRoutingInfoResponse;

			beforeAll(() => {
				fakeDriver.sendMessage.mockClear();

				expected = {
					nodeIds: [1, 4, 5],
				} as GetRoutingInfoResponse;
				fakeDriver.sendMessage.mockResolvedValue(expected);
			});

			it("should send a GetRoutingInfoRequest", async () => {
				await node.queryNeighbors();

				expect(fakeDriver.sendMessage).toBeCalled();
				const request: GetRoutingInfoRequest =
					fakeDriver.sendMessage.mock.calls[0][0];
				expect(request).toBeInstanceOf(GetRoutingInfoRequest);
				expect(request.nodeId).toBe(node.id);
			});

			it("should remember the neighbor list", async () => {
				await node.queryNeighbors();
				expect(node.neighbors).toContainAllValues(expected.nodeIds);
			});

			it("should set the interview stage to Neighbors", () => {
				expect(node.interviewStage).toBe(InterviewStage.Neighbors);
			});
		});

		describe("interview sequence", () => {
			let originalMethods: Partial<Record<keyof TestNode, any>>;
			beforeAll(() => {
				const interviewStagesAfter: Record<string, InterviewStage> = {
					queryProtocolInfo: InterviewStage.ProtocolInfo,
					queryNodeInfo: InterviewStage.NodeInfo,
					interviewCCs: InterviewStage.CommandClasses,
					// queryNodePlusInfo: InterviewStage.NodePlusInfo,
					// queryManufacturerSpecific:
					// 	InterviewStage.ManufacturerSpecific,
					// queryCCVersions: InterviewStage.Versions,
					// queryEndpoints: InterviewStage.Endpoints,
					queryNeighbors: InterviewStage.Neighbors,
					// configureWakeup: InterviewStage.WakeUp,
					// requestStaticValues: InterviewStage.Static,
				};
				const returnValues: Partial<Record<keyof TestNode, any>> = {
					ping: true,
				};
				originalMethods = {
					queryProtocolInfo: node.queryProtocolInfo,
					queryNodeInfo: node.queryNodeInfo,
					interviewCCs: node.interviewCCs,
					// queryNodePlusInfo: node.queryNodePlusInfo,
					// queryManufacturerSpecific: node.queryManufacturerSpecific,
					// queryCCVersions: node.queryCCVersions,
					// queryEndpoints: node.queryEndpoints,
					queryNeighbors: node.queryNeighbors,
					// configureWakeup: node.configureWakeup,
					// requestStaticValues: node.requestStaticValues,
				};
				for (const method of Object.keys(
					originalMethods,
				) as (keyof TestNode)[]) {
					(node as any)[method] = jest
						.fn()
						.mockName(`${method} mock`)
						.mockImplementation(() => {
							if (method in interviewStagesAfter)
								node.interviewStage =
									interviewStagesAfter[method];
							return method in returnValues
								? Promise.resolve(returnValues[method])
								: Promise.resolve();
						});
				}
			});

			beforeEach(() => {
				for (const method of Object.keys(originalMethods)) {
					(node as any)[method].mockClear();
				}
			});

			afterAll(() => {
				for (const method of Object.keys(
					originalMethods,
				) as (keyof TestNode)[]) {
					(node as any)[method] = originalMethods[method];
				}
			});

			it("should execute all the interview methods", async () => {
				node.interviewStage = InterviewStage.None;
				await node.interview();
				for (const method of Object.keys(originalMethods)) {
					expect((node as any)[method]).toBeCalled();
				}
			});

			it("should not execute any interview method if the interview is completed", async () => {
				node.interviewStage = InterviewStage.Complete;
				await node.interview();
				for (const method of Object.keys(originalMethods)) {
					expect((node as any)[method]).not.toBeCalled();
				}
			});

			it("should skip all methods that belong to an earlier stage", async () => {
				node.interviewStage = InterviewStage.NodeInfo;
				await node.interview();

				const expectCalled = [
					"interviewCCs",
					// "queryNodePlusInfo",
					// "queryManufacturerSpecific",
					// "queryCCVersions",
					// "queryEndpoints",
					// "requestStaticValues",
					// "configureWakeup",
					"queryNeighbors",
				];
				for (const method of Object.keys(originalMethods)) {
					if (expectCalled.indexOf(method) > -1) {
						expect((node as any)[method]).toBeCalled();
					} else {
						expect((node as any)[method]).not.toBeCalled();
					}
				}
			});

			it.todo("Test restarting from cache");
		});
	});

	describe("isAwake() / setAwake()", () => {
		const fakeDriver = createEmptyMockDriver();

		function makeNode(supportsWakeUp: boolean = false): ZWaveNode {
			const node = new ZWaveNode(2, (fakeDriver as unknown) as Driver);
			if (supportsWakeUp)
				node.addCC(CommandClasses["Wake Up"], { isSupported: true });
			fakeDriver.controller.nodes.set(node.id, node);
			return node;
		}

		it("newly created nodes should be assumed awake", () => {
			const node = makeNode();
			expect(node.isAwake()).toBeTrue();
		});

		it("setAwake() should NOT throw if the node does not support Wake Up", () => {
			const node = makeNode();
			expect(() => node.setAwake(true)).not.toThrow();
		});

		it("isAwake() should return the status set by setAwake()", () => {
			const node = makeNode(true);
			node.setAwake(false);
			expect(node.isAwake()).toBeFalse();
			node.setAwake(true);
			expect(node.isAwake()).toBeTrue();
		});

		it(`setAwake() should emit the "wake up" event when the node wakes up and "sleep" when it goes to sleep`, () => {
			const node = makeNode(true);
			const wakeupSpy = jest.fn();
			const sleepSpy = jest.fn();
			node.on("wake up", wakeupSpy).on("sleep", sleepSpy);
			for (const { state, expectWakeup, expectSleep } of [
				{ state: false, expectSleep: true, expectWakeup: false },
				{ state: true, expectSleep: false, expectWakeup: true },
				{ state: true, expectSleep: false, expectWakeup: false },
				{ state: false, expectSleep: true, expectWakeup: false },
			]) {
				wakeupSpy.mockClear();
				sleepSpy.mockClear();
				node.setAwake(state);
				expect(wakeupSpy).toBeCalledTimes(expectWakeup ? 1 : 0);
				expect(sleepSpy).toBeCalledTimes(expectSleep ? 1 : 0);
			}
		});
	});

	describe("updateNodeInfo()", () => {
		const fakeDriver = createEmptyMockDriver();

		function makeNode(supportsWakeUp: boolean = false): ZWaveNode {
			const node = new ZWaveNode(2, (fakeDriver as unknown) as Driver);
			if (supportsWakeUp)
				node.addCC(CommandClasses["Wake Up"], { isSupported: true });
			fakeDriver.controller.nodes.set(node.id, node);
			return node;
		}

		const emptyNodeInfo = {
			supportedCCs: [],
			controlledCCs: [],
		};

		it("marks a sleeping node as awake", () => {
			const node = makeNode(true);
			node.setAwake(false);

			node.updateNodeInfo(emptyNodeInfo as any);
			expect(node.isAwake()).toBeTrue();
		});

		it("does not throw when called on a non-sleeping node", () => {
			const node = makeNode(false);
			node.updateNodeInfo(emptyNodeInfo as any);
			expect(node.isAwake()).toBeTrue();
		});

		it("remembers all received CCs", () => {
			const node = makeNode();
			node.addCC(CommandClasses.Battery, {
				isControlled: true,
			});
			node.addCC(CommandClasses.Configuration, {
				isSupported: true,
			});

			node.updateNodeInfo({
				controlledCCs: [CommandClasses.Configuration],
				supportedCCs: [CommandClasses.Battery],
			} as any);
			expect(node.supportsCC(CommandClasses.Battery)).toBeTrue();
			expect(node.controlsCC(CommandClasses.Configuration)).toBeTrue();
		});

		it("ignores the data in an NIF if it was received already", () => {
			const node = makeNode();
			node.updateNodeInfo(emptyNodeInfo as any);
			node.updateNodeInfo({
				controlledCCs: [CommandClasses.Configuration],
				supportedCCs: [CommandClasses.Battery],
			} as any);

			expect(node.supportsCC(CommandClasses.Battery)).toBeFalse();
			expect(node.controlsCC(CommandClasses.Configuration)).toBeFalse();
		});
	});

	describe(`sendNoMoreInformation()`, () => {
		const fakeDriver = createEmptyMockDriver();

		function makeNode(/*supportsWakeUp: boolean = false*/): ZWaveNode {
			const node = new ZWaveNode(2, (fakeDriver as unknown) as Driver);
			// if (supportsWakeUp)
			node.addCC(CommandClasses["Wake Up"], { isSupported: true });
			fakeDriver.controller.nodes.set(node.id, node);
			return node;
		}

		beforeEach(() => fakeDriver.sendMessage.mockClear());

		it("should not do anything and return false if the node is asleep", async () => {
			const node = makeNode();
			node.setAwake(false);

			expect(await node.sendNoMoreInformation()).toBeFalse();
			expect(fakeDriver.sendMessage).not.toBeCalled();
		});

		it("should not do anything and return false if the node interview is not complete", async () => {
			const node = makeNode();
			node.interviewStage = InterviewStage.CommandClasses;
			expect(await node.sendNoMoreInformation()).toBeFalse();
			expect(fakeDriver.sendMessage).not.toBeCalled();
		});

		it("should not send anything if the node should be kept awake", async () => {
			const node = makeNode();
			node.setAwake(true);
			node.keepAwake = true;

			expect(await node.sendNoMoreInformation()).toBeFalse();
			expect(fakeDriver.sendMessage).not.toBeCalled();
		});

		it("should send a WakeupCC.NoMoreInformation otherwise", async () => {
			const node = makeNode();
			node.interviewStage = InterviewStage.Complete;
			expect(await node.sendNoMoreInformation()).toBeTrue();
			expect(fakeDriver.sendMessage).toBeCalled();

			assertCC(fakeDriver.sendMessage.mock.calls[0][0], {
				cc: WakeUpCC,
				nodeId: node.id,
				ccValues: {
					ccCommand: WakeUpCommand.NoMoreInformation,
				},
			});
		});

		it.todo("Test send failures");
	});

	describe("getCCVersion()", () => {
		const fakeDriver = (createEmptyMockDriver() as unknown) as Driver;

		it("should return 0 if a command class is not supported", () => {
			const node = new ZWaveNode(2, fakeDriver);
			expect(node.getCCVersion(CommandClasses["Anti-theft"])).toBe(0);
		});

		it("should return the supported version otherwise", () => {
			const node = new ZWaveNode(2, fakeDriver);
			node.addCC(CommandClasses["Anti-theft"], {
				isSupported: true,
				version: 5,
			});
			expect(node.getCCVersion(CommandClasses["Anti-theft"])).toBe(5);
		});
	});

	describe("removeCC()", () => {
		const fakeDriver = (createEmptyMockDriver() as unknown) as Driver;

		it("should mark a CC as not supported", () => {
			const node = new ZWaveNode(2, fakeDriver);
			node.addCC(CommandClasses["Anti-theft"], {
				isSupported: true,
				version: 7,
			});
			expect(node.getCCVersion(CommandClasses["Anti-theft"])).toBe(7);

			node.removeCC(CommandClasses["Anti-theft"]);
			expect(node.getCCVersion(CommandClasses["Anti-theft"])).toBe(0);
		});
	});

	describe("createCCInstance()", () => {
		const fakeDriver = createEmptyMockDriver();

		it("should throw if the CC is not supported", () => {
			const node = new ZWaveNode(2, fakeDriver as any);
			assertZWaveError(
				() => node.createCCInstance(CommandClasses.Basic),
				{
					errorCode: ZWaveErrorCodes.CC_NotSupported,
					messageMatches: "unsupported",
				},
			);
		});

		it("should return a linked instance of the correct CC", () => {
			const node = new ZWaveNode(2, fakeDriver as any);
			fakeDriver.controller.nodes.set(node.id, node);
			node.addCC(CommandClasses.Basic, { isSupported: true });

			const cc = node.createCCInstance(BasicCC)!;
			expect(cc).toBeInstanceOf(BasicCC);
			expect(cc.getNode()).toBe(node);
		});
	});

	describe("getEndpoint()", () => {
		const fakeDriver = createEmptyMockDriver();

		it("throws when a negative endpoint index is requested", () => {
			const node = new ZWaveNode(2, fakeDriver as any);
			assertZWaveError(() => node.getEndpoint(-1), {
				errorCode: ZWaveErrorCodes.Argument_Invalid,
				messageMatches: "must be positive",
			});
		});

		it("returns the node itself when endpoint 0 is requested", () => {
			const node = new ZWaveNode(2, fakeDriver as any);
			expect(node.getEndpoint(0)).toBe(node);
		});

		it("returns a new endpoint with the correct endpoint index otherwise", () => {
			const node = new ZWaveNode(2, fakeDriver as any);
			// interviewComplete needs to be true for getEndpoint to work
			node.valueDB.setValue(
				{
					commandClass: CommandClasses["Multi Channel"],
					property: "interviewComplete",
				},
				true,
			);
			node.valueDB.setValue(
				{
					commandClass: CommandClasses["Multi Channel"],
					property: "individualCount",
				},
				5,
			);
			const actual = node.getEndpoint(5)!;
			expect(actual.index).toBe(5);
			expect(actual.nodeId).toBe(2);
		});

		it("caches the created endpoint instances", () => {
			const node = new ZWaveNode(2, fakeDriver as any);
			// interviewComplete needs to be true for getEndpoint to work
			node.valueDB.setValue(
				{
					commandClass: CommandClasses["Multi Channel"],
					property: "interviewComplete",
				},
				true,
			);
			node.valueDB.setValue(
				{
					commandClass: CommandClasses["Multi Channel"],
					property: "individualCount",
				},
				5,
			);
			const first = node.getEndpoint(5);
			const second = node.getEndpoint(5);
			expect(first).not.toBeUndefined();
			expect(first).toBe(second);
		});

		it("returns undefined if a non-existent endpoint is requested", () => {
			const node = new ZWaveNode(2, fakeDriver as any);
			const actual = node.getEndpoint(5);
			expect(actual).toBeUndefined();
		});
	});

	describe("serialize() / deserialize()", () => {
		const fakeDriver = (createEmptyMockDriver() as unknown) as Driver;

		const serializedTestNode = {
			id: 1,
			interviewStage: "NodeInfo",
			deviceClass: {
				basic: 2,
				generic: 2,
				specific: 1,
			},
			isListening: true,
			isFrequentListening: false,
			isRouting: false,
			maxBaudRate: 40000,
			isSecure: false,
			isBeaming: true,
			version: 4,
			commandClasses: {
				"0x25": {
					name: "Binary Switch",
					endpoints: {
						"0": {
							isSupported: false,
							isControlled: true,
							version: 3,
						},
					},
				},
				"0x26": {
					name: "Multilevel Switch",
					endpoints: {
						"0": {
							isSupported: false,
							isControlled: true,
							version: 4,
						},
					},
				},
			},
			// TODO: These should be values
			// endpointCountIsDynamic: false,
			// endpointsHaveIdenticalCapabilities: true,
			// individualEndpointCount: 5,
			// aggregatedEndpointCount: 2,
			// endpoints: {
			// 	1: {
			// 		isDynamic: false,
			// 		genericClass: 5,
			// 		specificClass: 111,
			// 		supportedCCs: [1, 2, 3, 4],
			// 	},
			// },
		};

		it("serializing a deserialized node should result in the original object", () => {
			const node = new ZWaveNode(1, fakeDriver);
			// @ts-ignore We need write access to the map
			fakeDriver.controller!.nodes.set(1, node);
			node.deserialize(serializedTestNode);
			expect(node.serialize()).toEqual(serializedTestNode);
		});

		it("nodes with a completed interview don't get their stage reset when resuming from cache", () => {
			const node = new ZWaveNode(1, fakeDriver);
			// @ts-ignore We need write access to the map
			fakeDriver.controller!.nodes.set(1, node);
			node.deserialize(serializedTestNode);
			node.interviewStage = InterviewStage.RestartFromCache;
			expect(node.serialize().interviewStage).toEqual(
				InterviewStage[InterviewStage.Complete],
			);
		});

		it("the serialized command classes should include values and metadata", () => {
			const node = new ZWaveNode(1, fakeDriver, undefined, [
				CommandClasses.Basic,
			]);
			// @ts-ignore We need write access to the map
			fakeDriver.controller!.nodes.set(1, node);

			const valueId: ValueID = {
				commandClass: CommandClasses.Basic,
				property: "targetValue",
			};

			node.valueDB.setValue(valueId, 10);
			node.valueDB.setMetadata(valueId, ValueMetadata.WriteOnlyInt16);

			const serialized = node.serialize();
			// Test that all values are serialized
			expect(
				serialized.commandClasses["0x20"].values,
			).toIncludeAllMembers([
				{ endpoint: 0, property: "targetValue", value: 10 },
			]);
			// Test that all metadata is serialized
			expect(
				serialized.commandClasses["0x20"].metadata,
			).toIncludeAllMembers([
				{
					endpoint: 0,
					property: "targetValue",
					metadata: ValueMetadata.WriteOnlyInt16,
				},
			]);
		});

		it("deserialize() should correctly read values and metadata", () => {
			const input = { ...serializedTestNode };

			const valueId1 = {
				endpoint: 1,
				property: "targetValue",
			};
			const valueId2 = {
				endpoint: 2,
				property: "targetValue",
			};

			(input.commandClasses as any)["0x20"] = {
				name: "Basic",
				isSupported: false,
				isControlled: true,
				version: 1,
				values: [{ ...valueId1, value: 12 }],
				metadata: [
					{
						...valueId2,
						metadata: ValueMetadata.ReadOnlyInt32,
					},
				],
			};

			const node = new ZWaveNode(1, fakeDriver);
			// @ts-ignore We need write access to the map
			fakeDriver.controller!.nodes.set(1, node);
			node.deserialize(input);

			expect(
				node.valueDB.getValue({
					...valueId1,
					commandClass: CommandClasses.Basic,
				}),
			).toBe(12);
			expect(
				node.valueDB.getMetadata({
					...valueId2,
					commandClass: CommandClasses.Basic,
				}),
			).toBe(ValueMetadata.ReadOnlyInt32);
		});

		it("deserialize() should also accept numbers for the interview stage", () => {
			const input = {
				...serializedTestNode,
				interviewStage: InterviewStage.Neighbors,
			};
			const node = new ZWaveNode(1, fakeDriver);
			node.deserialize(input);
			expect(node.interviewStage).toBe(InterviewStage.Neighbors);
		});

		it("deserialize() should skip the deviceClass if it is malformed", () => {
			const node = new ZWaveNode(1, fakeDriver);
			const brokenDeviceClasses = [
				// not an object
				undefined,
				1,
				"foo",
				// incomplete
				{},
				{ basic: 1 },
				{ generic: 2 },
				{ specific: 3 },
				{ basic: 1, generic: 2 },
				{ basic: 1, specific: 3 },
				{ generic: 2, specific: 3 },
				// wrong type
				{ basic: "1", generic: 2, specific: 3 },
				{ basic: 1, generic: true, specific: 3 },
				{ basic: 1, generic: 2, specific: {} },
			];
			for (const dc of brokenDeviceClasses) {
				const input = {
					...serializedTestNode,
					deviceClass: dc,
				};
				(node as any)._deviceClass = undefined;
				node.deserialize(input);
				expect(node.deviceClass).toBeUndefined();
			}
		});

		it("deserialize() should skip any primitive properties that have the wrong type", () => {
			const node = new ZWaveNode(1, fakeDriver);
			const wrongInputs: [string, any][] = [
				["isListening", 1],
				["isFrequentListening", "2"],
				["isRouting", {}],
				["maxBaudRate", true],
				["isSecure", 3],
				["isBeaming", "3"],
				["version", false],
			];
			for (const [prop, val] of wrongInputs) {
				const input = {
					...serializedTestNode,
					[prop]: val,
				};
				(node as any)["_" + prop] = undefined;
				node.deserialize(input);
				expect((node as any)[prop]).toBeUndefined();
			}
		});

		it("deserialize() should skip command classes that don't have a HEX key", () => {
			const node = new ZWaveNode(1, fakeDriver);
			const input = {
				...serializedTestNode,
				commandClasses: {
					"Binary Switch": {
						name: "Binary Switch",
						isSupported: false,
						isControlled: true,
						version: 3,
					},
				},
			};
			node.deserialize(input);
			expect(node.implementedCommandClasses.size).toBe(0);
		});

		it("deserialize() should skip command classes that are not known to this library", () => {
			const node = new ZWaveNode(1, fakeDriver);
			const input = {
				...serializedTestNode,
				commandClasses: {
					"0x001122ff": {
						name: "Binary Switch",
						isSupported: false,
						isControlled: true,
						version: 3,
					},
				},
			};
			node.deserialize(input);
			expect(node.implementedCommandClasses.size).toBe(0);
		});

		it("deserialize() should not parse any malformed CC properties", () => {
			const node = new ZWaveNode(1, fakeDriver);
			const input = {
				...serializedTestNode,
				commandClasses: {
					"0x25": {
						isSupported: 1,
					},
					"0x26": {
						isControlled: "",
					},
					"0x27": {
						isSupported: true,
						version: "5",
					},
				},
			};
			node.deserialize(input);
			expect(node.supportsCC(0x25)).toBeFalse();
			expect(node.controlsCC(0x26)).toBeFalse();
			expect(node.getCCVersion(0x27)).toBe(0);
		});
	});

	describe("the emitted events", () => {
		let node: ZWaveNode;
		const fakeDriver = createEmptyMockDriver();

		const onValueAdded = jest.fn();
		const onValueUpdated = jest.fn();
		const onValueRemoved = jest.fn();

		function createNode(): void {
			node = new ZWaveNode(1, (fakeDriver as unknown) as Driver)
				.on("value added", onValueAdded)
				.on("value updated", onValueUpdated)
				.on("value removed", onValueRemoved);
		}

		beforeEach(() => {
			createNode();
			onValueAdded.mockClear();
			onValueUpdated.mockClear();
			onValueRemoved.mockClear();
		});

		it("should contain a speaking name for the CC", () => {
			const cc = CommandClasses["Wake Up"];
			const ccName = CommandClasses[cc];
			const valueId: ValueID = {
				commandClass: cc,
				property: "fooProp",
			};
			node.valueDB.setValue(valueId, 1);
			expect(onValueAdded).toBeCalled();
			node.valueDB.setValue(valueId, 3);
			expect(onValueUpdated).toBeCalled();
			node.valueDB.clear();
			expect(onValueRemoved).toBeCalled();

			for (const method of [
				onValueAdded,
				onValueUpdated,
				onValueRemoved,
			]) {
				const cbArg = method.mock.calls[0][1];
				expect(cbArg.commandClassName).toBe(ccName);
			}
		});

		it("should contain a speaking name for the propertyKey", () => {
			node.valueDB.setValue(
				{
					commandClass: CommandClasses["Thermostat Setpoint"],
					property: "setpoint",
					propertyKey: 1 /* Heating */,
				},
				5,
			);
			expect(onValueAdded).toBeCalled();
			const cbArg = onValueAdded.mock.calls[0][1];
			expect(cbArg.propertyKeyName).toBe("Heating");
		});

		it("should not be emitted for internal values", () => {
			node.valueDB.setValue(
				{
					commandClass: CommandClasses.Battery,
					property: "interviewComplete", // interviewCompleted is an internal value
				},
				true,
			);
			expect(onValueAdded).not.toBeCalled();
		});
	});

	describe("changing the node status", () => {
		interface TestOptions {
			initialStatus: NodeStatus;
			targetStatus: NodeStatus;
			expectedEvent: ZWaveNodeEvents;
			expectCall?: boolean; // default true
		}

		function performTest(options: TestOptions): void {
			const node = new ZWaveNode(1, undefined as any);
			node.status = options.initialStatus;
			const spy = jest.fn();
			node.on(options.expectedEvent, spy);
			node.status = options.targetStatus;
			if (options.expectCall !== false) {
				expect(spy).toBeCalled();
			} else {
				expect(spy).not.toBeCalled();
			}
		}
		it("from asleep to dead should raise the dead event", () => {
			performTest({
				initialStatus: NodeStatus.Asleep,
				targetStatus: NodeStatus.Dead,
				expectedEvent: "dead",
			});
		});

		it("from asleep to awake should raise the wake up event", () => {
			performTest({
				initialStatus: NodeStatus.Asleep,
				targetStatus: NodeStatus.Awake,
				expectedEvent: "wake up",
			});
		});

		it("from asleep to asleep should raise NO event", () => {
			performTest({
				initialStatus: NodeStatus.Asleep,
				targetStatus: NodeStatus.Asleep,
				expectedEvent: "sleep",
				expectCall: false,
			});
		});

		it("from awake to dead should raise the dead event", () => {
			performTest({
				initialStatus: NodeStatus.Awake,
				targetStatus: NodeStatus.Dead,
				expectedEvent: "dead",
			});
		});

		it("from awake to asleep should raise the sleep event", () => {
			performTest({
				initialStatus: NodeStatus.Awake,
				targetStatus: NodeStatus.Asleep,
				expectedEvent: "sleep",
			});
		});

		it("from awake to awake should raise NO event", () => {
			performTest({
				initialStatus: NodeStatus.Awake,
				targetStatus: NodeStatus.Awake,
				expectedEvent: "wake up",
				expectCall: false,
			});
		});

		it("from unknown to dead should raise the dead event", () => {
			performTest({
				initialStatus: NodeStatus.Unknown,
				targetStatus: NodeStatus.Dead,
				expectedEvent: "dead",
			});
		});

		it("from unknown to awake should raise the wake up event", () => {
			performTest({
				initialStatus: NodeStatus.Unknown,
				targetStatus: NodeStatus.Awake,
				expectedEvent: "wake up",
			});
		});

		it("from unknown to asleep should raise the sleep event", () => {
			performTest({
				initialStatus: NodeStatus.Unknown,
				targetStatus: NodeStatus.Asleep,
				expectedEvent: "sleep",
			});
		});

		it("from dead to asleep should raise the alive event AND the sleep event", () => {
			performTest({
				initialStatus: NodeStatus.Dead,
				targetStatus: NodeStatus.Asleep,
				expectedEvent: "alive",
			});
			performTest({
				initialStatus: NodeStatus.Dead,
				targetStatus: NodeStatus.Asleep,
				expectedEvent: "sleep",
			});
		});

		it("from dead to awake should raise the alive event AND the wake up event", () => {
			performTest({
				initialStatus: NodeStatus.Dead,
				targetStatus: NodeStatus.Awake,
				expectedEvent: "alive",
			});
			performTest({
				initialStatus: NodeStatus.Dead,
				targetStatus: NodeStatus.Awake,
				expectedEvent: "wake up",
			});
		});
	});

	describe("getValue()", () => {
		const fakeDriver = createEmptyMockDriver();
		it("returns the values stored in the value DB", () => {
			const node = new ZWaveNode(1, fakeDriver as any);
			const valueId: ValueID = {
				commandClass: CommandClasses.Version,
				endpoint: 2,
				property: "3",
			};

			node.valueDB.setValue(valueId, 4);

			expect(node.getValue(valueId)).toBe(4);
		});
	});

	describe("setValue()", () => {
		const fakeDriver = createEmptyMockDriver();
		it("issues the correct xyzCCSet command", async () => {
			// We test with a BasicCC
			const node = new ZWaveNode(1, fakeDriver as any);
			node.addCC(CommandClasses.Basic, { isSupported: true });

			// Since setValue also issues a get, we need to mock a response
			fakeDriver.sendMessage
				.mockResolvedValueOnce(undefined)
				// For some reason this is called twice?!
				.mockResolvedValue({ command: {} });

			const result = await node.setValue(
				{
					commandClass: CommandClasses.Basic,
					property: "targetValue",
				},
				5,
			);

			expect(result).toBeTrue();
			expect(fakeDriver.sendMessage).toBeCalled();

			assertCC(fakeDriver.sendMessage.mock.calls[0][0], {
				cc: BasicCC,
				nodeId: node.id,
				ccValues: {
					ccCommand: BasicCommand.Set,
				},
			});
		});

		it("returns false if the CC is not implemented", async () => {
			const node = new ZWaveNode(1, fakeDriver as any);
			const result = await node.setValue(
				{
					commandClass: 0xbada55, // this is guaranteed to not be implemented
					property: "test",
				},
				1,
			);
			expect(result).toBeFalse();
		});
	});

	describe("getValueMetadata()", () => {
		const fakeDriver = createEmptyMockDriver();
		let node: ZWaveNode;
		const valueId: ValueID = {
			commandClass: CommandClasses.Basic,
			property: "currentValue",
		};

		beforeEach(() => {
			node = new ZWaveNode(1, (fakeDriver as unknown) as Driver);
			fakeDriver.controller!.nodes.set(1, node);
		});

		it("returns the defined metadata for the given value", () => {
			// We test this with the BasicCC
			// currentValue is readonly, 0-99
			const currentValueMeta = node.getValueMetadata(valueId);
			expect(currentValueMeta).toMatchObject({
				readable: true,
				writeable: false,
				min: 0,
				max: 99,
			});
		});

		it("dynamic metadata is merged with static metadata", () => {
			// Create dynamic metadata
			node.valueDB.setMetadata(valueId, ValueMetadata.WriteOnlyInt32);

			const currentValueMeta = node.getValueMetadata(valueId);

			// The label should be preserved from the static metadata
			expect(currentValueMeta).toMatchObject({ label: "Current value" });
		});

		it("dynamic metadata is prioritized", () => {
			// Update the dynamic metadata
			node.valueDB.setMetadata(valueId, ValueMetadata.WriteOnlyInt32);

			const currentValueMeta = node.getValueMetadata(valueId);

			// But the dynamic metadata properties are preferred over statically defined ones
			expect(currentValueMeta).toMatchObject(
				ValueMetadata.WriteOnlyInt32,
			);
		});
	});
});
