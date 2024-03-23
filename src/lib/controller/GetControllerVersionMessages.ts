import { IDriver } from "../driver/IDriver";
import {
	FunctionType,
	MessagePriority,
	MessageType,
} from "../message/Constants";
import {
	expectedResponse,
	Message,
	MessageDeserializationOptions,
	messageTypes,
	priority,
} from "../message/Message";
import { JSONObject } from "../util/misc";
import { cpp2js } from "../util/strings";
import { ZWaveLibraryTypes } from "./ZWaveLibraryTypes";

@messageTypes(MessageType.Request, FunctionType.GetControllerVersion)
@expectedResponse(FunctionType.GetControllerVersion)
@priority(MessagePriority.Controller)
export class GetControllerVersionRequest extends Message {}

@messageTypes(MessageType.Response, FunctionType.GetControllerVersion)
export class GetControllerVersionResponse extends Message {
	public constructor(
		driver: IDriver,
		options: MessageDeserializationOptions,
	) {
		super(driver, options);

		// The payload consists of a zero-terminated string and a uint8 for the controller type
		this._libraryVersion = cpp2js(this.payload.toString("ascii"));
		this._controllerType = this.payload[this.libraryVersion.length + 1];
	}

	private _controllerType: ZWaveLibraryTypes;
	public get controllerType(): ZWaveLibraryTypes {
		return this._controllerType;
	}

	private _libraryVersion: string;
	public get libraryVersion(): string {
		return this._libraryVersion;
	}

	public toJSON(): JSONObject {
		return super.toJSONInherited({
			controllerType: this.controllerType,
			libraryVersion: this.libraryVersion,
		});
	}
}
