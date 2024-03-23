import { createEmptyMockDriver } from "../../../test/mocks";
import { BasicCCGet, BasicCCReport, BasicCCSet } from "../commandclass/BasicCC";
import { MultiChannelCC } from "../commandclass/MultiChannelCC";
import { MultiCommandCC } from "../commandclass/MultiCommandCC";
import { NoOperationCC } from "../commandclass/NoOperationCC";
import {
	SupervisionCC,
	SupervisionCCReport,
	SupervisionStatus,
} from "../commandclass/SupervisionCC";
import { IDriver } from "../driver/IDriver";
import { FunctionType, MessageType } from "../message/Constants";
import {
	getExpectedResponse,
	getFunctionType,
	getMessageType,
	Message,
	ResponsePredicate,
} from "../message/Message";
import { ApplicationCommandRequest } from "./ApplicationCommandRequest";
import {
	SendDataRequest,
	SendDataRequestBase,
	SendDataRequestTransmitReport,
	SendDataResponse,
	TransmitOptions,
	TransmitStatus,
} from "./SendDataMessages";

const fakeDriver = (createEmptyMockDriver() as unknown) as IDriver;

function createSendDataMessage(
	type: MessageType,
	payload?: Buffer,
): SendDataRequestBase | SendDataResponse {
	const msg = new Message(fakeDriver, {
		type,
		functionType: FunctionType.SendData,
		payload,
	});
	const data = msg.serialize();
	const ret =
		type === MessageType.Request
			? new SendDataRequestBase(fakeDriver, { data })
			: new SendDataResponse(fakeDriver, { data });
	return ret;
}

describe("lib/controller/SendDataRequest => ", () => {
	const req = new SendDataRequest(fakeDriver, {} as any);

	it("should be a Message", () => {
		expect(req).toBeInstanceOf(Message);
	});
	it("with type Request", () => {
		expect(getMessageType(req)).toBe(MessageType.Request);
	});
	it("and a function type SendData", () => {
		expect(getFunctionType(req)).toBe(FunctionType.SendData);
	});
	it("that expects a SendDataRequest or SendDataResponse in return", () => {
		const predicate = getExpectedResponse(req) as ResponsePredicate;
		expect(predicate).toBeInstanceOf(Function);

		const controllerFail = createSendDataMessage(
			MessageType.Response,
			Buffer.from([0]),
		);
		// "A SendDataResponse with wasSent=false was not detected as fatal_controller!"
		expect(predicate({} as any, controllerFail)).toBe("fatal_controller");

		const controllerSuccess = createSendDataMessage(
			MessageType.Response,
			Buffer.from([1]),
		);
		// "A SendDataResponse with wasSent=true was not detected as confirmation!"
		expect(predicate({} as any, controllerSuccess)).toBe("confirmation");

		const nodeFail = createSendDataMessage(
			MessageType.Request,
			Buffer.from([0, 1]),
		);
		// "A SendDataRequest with isFailed=true was not detected as fatal_node!"
		expect(
			predicate(
				{
					hasCallbackId: () => true,
					callbackId: (nodeFail as SendDataRequestTransmitReport)
						.callbackId,
					command: {} as any,
				} as any,
				nodeFail,
			),
		).toBe("fatal_node");

		const nodeSuccess = createSendDataMessage(
			MessageType.Request,
			Buffer.from([0, 0]),
		);
		// "A SendDataRequest with isFailed=false was not detected as final!"
		expect(
			predicate(
				{
					hasCallbackId: () => true,
					callbackId: (nodeSuccess as SendDataRequestTransmitReport)
						.callbackId,
					command: {} as any,
				} as any,
				nodeSuccess,
			),
		).toBe("final");

		const somethingElse = new Message(fakeDriver, {
			type: MessageType.Request,
			functionType: FunctionType.ApplicationCommand,
		});
		// "An unrelated message was not detected as unexpected!"
		expect(
			predicate(
				{
					command: {} as any,
				} as any,
				somethingElse,
			),
		).toBe("unexpected");
	});

	// We cannot parse these kinds of messages atm.
	// it.skip("should extract all properties correctly", () => {
	// 	// an actual message from OZW
	// 	const rawBuf = Buffer.from("010900130b0226022527ca", "hex");
	// 	//                         payload: ID  CC  TXcb
	// 	//                      cc payload: ------^^
	// 	const parsed = new SendDataRequest(undefined);
	// 	parsed.deserialize(rawBuf);

	// 	expect(parsed.command).toBeInstanceOf(CommandClass);
	// 	expect(parsed.command.nodeId).toBe(11);
	// 	expect(parsed.command.ccCommand).toBe(
	// 		CommandClasses["Multilevel Switch"],
	// 	);
	// 	expect(parsed.command.payload).toEqual(Buffer.from([0x02]));

	// 	expect(parsed.transmitOptions).toBe(TransmitOptions.DEFAULT);
	// 	expect(parsed.callbackId).toBe(0x27);
	// });

	// TODO: This should be in the ApplicationCommandRequest tests
	// it.skip("should retrieve the correct CC constructor", () => {
	// 	// we use a NoOP message here as the other CCs aren't implemented yet
	// 	const raw = Buffer.from("010900130d0200002515da", "hex");
	// 	expect(Message.getConstructor(raw)).toBe(SendDataRequest);

	// 	const srq = new SendDataRequest(undefined as any);
	// 	srq.deserialize(raw);
	// 	expect(srq.command).toBeInstanceOf(NoOperationCC);
	// });

	const createRequest = (function*() {
		const noOp = new NoOperationCC(fakeDriver, { nodeId: 2 });
		while (true) yield new SendDataRequest(fakeDriver, { command: noOp });
	})();

	it("new ones should have default transmit options and a numeric callback id", () => {
		const newOne = createRequest.next().value;
		expect(newOne.transmitOptions).toBe(TransmitOptions.DEFAULT);
		expect(newOne.callbackId).toBeNumber();
	});

	it("serialize() should concatenate the serialized CC with transmit options and callback ID", () => {
		const cc = new BasicCCGet(fakeDriver, { nodeId: 1 });
		const serializedCC = cc.serialize();

		const msg = new SendDataRequest(fakeDriver, {
			command: cc,
			callbackId: 66,
		});
		msg.serialize();
		// we don't care about the frame, only the message payload itself
		const serializedMsg = msg.payload;

		const expected = Buffer.concat([
			serializedCC,
			Buffer.from([TransmitOptions.DEFAULT, 66]),
		]);
		expect(serializedMsg).toEqual(expected);
	});

	// This is avoided through strictNullChecks
	// it("serialize() should throw when there is no CC", () => {
	// 	const msg = new SendDataRequest(fakeDriver, {});
	// 	assertZWaveError(() => msg.serialize(), {
	// 		messageMatches: "without a command",
	// 		errorCode: ZWaveErrorCodes.PacketFormat_Invalid,
	// 	});
	// });
});

describe("lib/controller/SendDataResponse => ", () => {
	const res = new SendDataResponse(fakeDriver, {} as any);

	it("should be a Message", () => {
		expect(res).toBeInstanceOf(Message);
	});
	it("with type Response", () => {
		expect(getMessageType(res)).toBe(MessageType.Response);
	});
	it("and a function type SendData", () => {
		expect(getFunctionType(res)).toBe(FunctionType.SendData);
	});
	it("that expects NO response", () => {
		expect(getExpectedResponse(res)).toBeUndefined();
	});
});

describe("testResponse() returns the correct ResponseRole", () => {
	it("BasicCCSet => TransmitReport = final", () => {
		const ccRequest = new BasicCCSet(fakeDriver, {
			nodeId: 2,
			endpoint: 2,
			targetValue: 7,
		});

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 99,
		});
		const msgResponse = new SendDataRequestTransmitReport(fakeDriver, {
			transmitStatus: TransmitStatus.OK,
			callbackId: msgRequest.callbackId,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("final");
	});

	it("BasicCCSet => BasicCCReport = unexpected", () => {
		const ccRequest = new BasicCCSet(fakeDriver, {
			nodeId: 2,
			endpoint: 2,
			targetValue: 7,
		});
		const ccResponse = new BasicCCReport(fakeDriver, {
			nodeId: ccRequest.nodeId,
			currentValue: 7,
		});

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 99,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("unexpected");
	});

	it("BasicCCGet => TransmitReport = confirmation", () => {
		const ccRequest = new BasicCCGet(fakeDriver, {
			nodeId: 2,
		});

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new SendDataRequestTransmitReport(fakeDriver, {
			transmitStatus: TransmitStatus.OK,
			callbackId: msgRequest.callbackId,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("confirmation");
	});

	it("BasicCCGet => BasicCCReport = final", () => {
		const ccRequest = new BasicCCGet(fakeDriver, {
			nodeId: 2,
		});
		const ccResponse = new BasicCCReport(fakeDriver, {
			nodeId: ccRequest.nodeId,
			currentValue: 7,
		});

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("final");
	});

	it("BasicCCGet => BasicCCSet = unexpected", () => {
		const ccRequest = new BasicCCGet(fakeDriver, {
			nodeId: 2,
		});
		const ccResponse = new BasicCCSet(fakeDriver, {
			nodeId: ccRequest.nodeId,
			targetValue: 7,
		});

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("unexpected");
	});

	it("MultiChannelCC/BasicCCGet => MultiChannelCC/BasicCCReport = final", () => {
		const ccRequest = MultiChannelCC.encapsulate(
			fakeDriver,
			new BasicCCGet(fakeDriver, {
				nodeId: 2,
				endpoint: 2,
			}),
		);
		const ccResponse = MultiChannelCC.encapsulate(
			fakeDriver,
			new BasicCCReport(fakeDriver, {
				nodeId: ccRequest.nodeId,
				currentValue: 7,
			}),
		);

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("final");
	});

	it("MultiChannelCC/BasicCCGet => MultiChannelCC/BasicCCGet = unexpected", () => {
		const ccRequest = MultiChannelCC.encapsulate(
			fakeDriver,
			new BasicCCGet(fakeDriver, {
				nodeId: 2,
				endpoint: 2,
			}),
		);
		const ccResponse = MultiChannelCC.encapsulate(
			fakeDriver,
			new BasicCCGet(fakeDriver, {
				nodeId: ccRequest.nodeId,
				endpoint: 2,
			}),
		);

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("unexpected");
	});

	it("MultiChannelCC/BasicCCGet => TransmitReport = confirmation", () => {
		const ccRequest = MultiChannelCC.encapsulate(
			fakeDriver,
			new BasicCCGet(fakeDriver, {
				nodeId: 2,
				endpoint: 2,
			}),
		);

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new SendDataRequestTransmitReport(fakeDriver, {
			transmitStatus: TransmitStatus.OK,
			callbackId: msgRequest.callbackId,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("confirmation");
	});

	it("MultiChannelCC/BasicCCSet => TransmitReport = final", () => {
		const ccRequest = MultiChannelCC.encapsulate(
			fakeDriver,
			new BasicCCSet(fakeDriver, {
				nodeId: 2,
				endpoint: 2,
				targetValue: 7,
			}),
		);

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 88,
		});
		const msgResponse = new SendDataRequestTransmitReport(fakeDriver, {
			transmitStatus: TransmitStatus.OK,
			callbackId: msgRequest.callbackId,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("final");
	});

	it("MultiChannelCC/BasicCCGet => MultiCommandCC/BasicCCReport = unexpected", () => {
		const ccRequest = MultiChannelCC.encapsulate(
			fakeDriver,
			new BasicCCGet(fakeDriver, {
				nodeId: 2,
				endpoint: 2,
			}),
		);
		const ccResponse = MultiCommandCC.encapsulate(fakeDriver, [
			new BasicCCReport(fakeDriver, {
				nodeId: ccRequest.nodeId,
				currentValue: 7,
			}),
		]);

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("unexpected");
	});

	it("SupervisionCC/BasicCCSet => TransmitReport = confirmation", () => {
		const ccRequest = SupervisionCC.encapsulate(
			fakeDriver,
			new BasicCCSet(fakeDriver, {
				nodeId: 2,
				targetValue: 5,
			}),
		);

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 8,
		});
		const msgResponse = new SendDataRequestTransmitReport(fakeDriver, {
			transmitStatus: TransmitStatus.OK,
			callbackId: msgRequest.callbackId,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("confirmation");
	});

	it("SupervisionCC/BasicCCSet => SupervisionCCReport (correct session ID) = final", () => {
		const ccRequest = SupervisionCC.encapsulate(
			fakeDriver,
			new BasicCCSet(fakeDriver, {
				nodeId: 2,
				targetValue: 5,
			}),
		);
		const ccResponse = new SupervisionCCReport(fakeDriver, {
			nodeId: 2,
			moreUpdatesFollow: false,
			sessionId: ccRequest.sessionId,
			status: SupervisionStatus.Success,
		});

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 89,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("final");
	});

	it("SupervisionCC/BasicCCSet => SupervisionCCReport (wrong session ID) = unexpected", () => {
		const ccRequest = SupervisionCC.encapsulate(
			fakeDriver,
			new BasicCCSet(fakeDriver, {
				nodeId: 2,
				targetValue: 5,
			}),
		);
		const ccResponse = new SupervisionCCReport(fakeDriver, {
			nodeId: 2,
			moreUpdatesFollow: false,
			sessionId: ccRequest.sessionId + 1,
			status: SupervisionStatus.Success,
		});

		const msgRequest = new SendDataRequest(fakeDriver, {
			command: ccRequest,
			callbackId: 89,
		});
		const msgResponse = new ApplicationCommandRequest(fakeDriver, {
			command: ccResponse,
		});

		expect(msgRequest.testResponse(msgResponse)).toBe("unexpected");
	});
});
