import { IDriver } from "../driver/IDriver";
import { ZWaveError, ZWaveErrorCodes } from "../error/ZWaveError";
import { validatePayload } from "../util/misc";
import { Duration } from "../values/Duration";
import { Maybe } from "../values/Primitive";
import { CCAPI } from "./API";
import {
	API,
	CCCommand,
	CCCommandOptions,
	CCResponsePredicate,
	CommandClass,
	commandClass,
	CommandClassDeserializationOptions,
	expectedCCResponse,
	gotDeserializationOptions,
	implementedVersion,
} from "./CommandClass";
import { CommandClasses } from "./CommandClasses";

// @noSetValueAPI - This CC has no values to set
// @noInterview - This CC is only used for encapsulation

// All the supported commands
export enum SupervisionCommand {
	Get = 0x01,
	Report = 0x02,
}

export enum SupervisionStatus {
	NoSupport = 0x00,
	Working = 0x01,
	Fail = 0x02,
	Success = 0xff,
}

export interface SupervisionResult {
	status: SupervisionStatus;
	remainingDuration?: Duration;
}

let sessionId = 0;
/** Returns the next session ID to be used for supervision */
export function getNextSessionId(): number {
	// TODO: Check if this needs to be on the driver for Security
	sessionId = (sessionId + 1) & 0b111111;
	if (sessionId === 0) sessionId++;
	return sessionId;
}

@API(CommandClasses.Supervision)
export class SupervisionCCAPI extends CCAPI {
	public supportsCommand(cmd: SupervisionCommand): Maybe<boolean> {
		switch (cmd) {
			case SupervisionCommand.Get:
				return true; // This is mandatory
		}
		return super.supportsCommand(cmd);
	}

	public async sendEncapsulated(
		encapsulated: CommandClass,
		// If possible, keep us updated about the progress
		requestStatusUpdates: boolean = true,
	): Promise<void> {
		this.assertSupportsCommand(SupervisionCommand, SupervisionCommand.Get);

		const cc = new SupervisionCCGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			requestStatusUpdates,
			encapsulated,
		});
		await this.driver.sendCommand(cc);
	}
}

@commandClass(CommandClasses.Supervision)
@implementedVersion(1)
export class SupervisionCC extends CommandClass {
	declare ccCommand: SupervisionCommand;

	/** Tests if a command should be supervised and thus requires encapsulation */
	public static requiresEncapsulation(cc: CommandClass): boolean {
		return cc.supervised && !(cc instanceof SupervisionCCGet);
	}

	/** Encapsulates a command that targets a specific endpoint */
	public static encapsulate(
		driver: IDriver,
		cc: CommandClass,
		requestStatusUpdates: boolean = true,
	): SupervisionCCGet {
		return new SupervisionCCGet(driver, {
			nodeId: cc.nodeId,
			// Supervision CC is wrapped inside MultiChannel CCs, so the endpoint must be copied
			endpoint: cc.endpointIndex,
			encapsulated: cc,
			requestStatusUpdates,
		});
	}

	/** Unwraps a supervision encapsulated command */
	public static unwrap(cc: SupervisionCCGet): CommandClass {
		return cc.encapsulated;
	}
}

type SupervisionCCReportOptions = CCCommandOptions & {
	moreUpdatesFollow: boolean;
	sessionId: number;
} & (
		| {
				status: SupervisionStatus.Working;
				duration: Duration;
		  }
		| {
				status:
					| SupervisionStatus.NoSupport
					| SupervisionStatus.Fail
					| SupervisionStatus.Success;
		  }
	);

@CCCommand(SupervisionCommand.Report)
export class SupervisionCCReport extends SupervisionCC {
	public constructor(
		driver: IDriver,
		options:
			| CommandClassDeserializationOptions
			| SupervisionCCReportOptions,
	) {
		super(driver, options);

		if (gotDeserializationOptions(options)) {
			validatePayload(this.payload.length >= 3);
			this.moreUpdatesFollow = !!(this.payload[0] & 0b1_0_000000);
			this.sessionId = this.payload[0] & 0b111111;
			this.status = this.payload[1];
			this.duration = Duration.parseReport(this.payload[2]);
		} else {
			this.moreUpdatesFollow = options.moreUpdatesFollow;
			this.sessionId = options.sessionId;
			this.status = options.status;
			if (options.status === SupervisionStatus.Working) {
				this.duration = options.duration;
			}
		}
	}

	public readonly moreUpdatesFollow: boolean;
	public readonly sessionId: number;
	public readonly status: SupervisionStatus;
	public readonly duration: Duration | undefined;
}

interface SupervisionCCGetOptions extends CCCommandOptions {
	requestStatusUpdates: boolean;
	encapsulated: CommandClass;
}

const testResponseForSupervisionCCGet: CCResponsePredicate = (
	sent: SupervisionCCGet,
	received,
	isPositiveTransmitReport,
) => {
	return received instanceof SupervisionCCReport &&
		received.sessionId === sent.sessionId
		? "final"
		: isPositiveTransmitReport
		? "confirmation"
		: "unexpected";
};

@CCCommand(SupervisionCommand.Get)
@expectedCCResponse(testResponseForSupervisionCCGet)
export class SupervisionCCGet extends SupervisionCC {
	public constructor(
		driver: IDriver,
		options: CommandClassDeserializationOptions | SupervisionCCGetOptions,
	) {
		super(driver, options);
		if (gotDeserializationOptions(options)) {
			// TODO: Deserialize payload
			throw new ZWaveError(
				`${this.constructor.name}: deserialization not implemented`,
				ZWaveErrorCodes.Deserialization_NotImplemented,
			);
		} else {
			this.sessionId = getNextSessionId();
			this.requestStatusUpdates = options.requestStatusUpdates;
			this.encapsulated = options.encapsulated;
		}
	}

	public requestStatusUpdates: boolean;
	public sessionId: number;
	public encapsulated: CommandClass;

	public serialize(): Buffer {
		const encapCC = this.encapsulated.serializeForEncapsulation();
		this.payload = Buffer.concat([
			Buffer.from([
				(this.requestStatusUpdates ? 0b10_000000 : 0) |
					(this.sessionId & 0b111111),
				encapCC.length,
			]),
			encapCC,
		]);
		return super.serialize();
	}
}
