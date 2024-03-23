import { IDriver } from "../driver/IDriver";
import log from "../log";
import { Endpoint } from "../node/Endpoint";
import { validatePayload } from "../util/misc";
import { Maybe } from "../values/Primitive";
import {
	CCAPI,
	SetValueImplementation,
	SET_VALUE,
	throwUnsupportedProperty,
	throwWrongValueType,
} from "./API";
import {
	API,
	CCCommand,
	CCCommandOptions,
	CommandClass,
	commandClass,
	CommandClassDeserializationOptions,
	expectedCCResponse,
	gotDeserializationOptions,
	implementedVersion,
} from "./CommandClass";
import { CommandClasses } from "./CommandClasses";

// All the supported commands
export enum TimeParametersCommand {
	Set = 0x01,
	Get = 0x02,
	Report = 0x03,
}

/**
 * Determines if the node expects local time instead of UTC.
 */
function shouldUseLocalTime(endpoint: Endpoint): boolean {
	// GH#311 Some nodes have no way to determine the time zone offset,
	// so they need to interpret the set time as local time instead of UTC.
	//
	// This is the case when they both
	// 1. DON'T control TimeCC V1, so they cannot request the local time
	// 2. DON'T support TimeCC V2, so the controller cannot specify the timezone offset
	// Incidentally, this is also true when they don't support TimeCC at all
	const ccVersion = endpoint.getCCVersion(CommandClasses.Time);
	if (ccVersion >= 1 && endpoint.controlsCC(CommandClasses.Time))
		return false;
	if (ccVersion >= 2 && endpoint.supportsCC(CommandClasses.Time))
		return false;

	return true;
}

interface DateSegments {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function segmentsToDate(segments: DateSegments, local: boolean): Date {
	if (local) {
		return new Date(
			segments.year,
			segments.month - 1,
			segments.day,
			segments.hour,
			segments.minute,
			segments.second,
		);
	} else {
		return new Date(
			Date.UTC(
				segments.year,
				segments.month - 1,
				segments.day,
				segments.hour,
				segments.minute,
				segments.second,
			),
		);
	}
}

function dateToSegments(date: Date, local: boolean): DateSegments {
	return {
		year: (date as any)[`get${local ? "" : "UTC"}FullYear`](),
		month: (date as any)[`get${local ? "" : "UTC"}Month`]() + 1,
		day: (date as any)[`get${local ? "" : "UTC"}Date`](),
		hour: (date as any)[`get${local ? "" : "UTC"}Hours`](),
		minute: (date as any)[`get${local ? "" : "UTC"}Minutes`](),
		second: (date as any)[`get${local ? "" : "UTC"}Seconds`](),
	};
}

@API(CommandClasses["Time Parameters"])
export class TimeParametersCCAPI extends CCAPI {
	public supportsCommand(cmd: TimeParametersCommand): Maybe<boolean> {
		switch (cmd) {
			case TimeParametersCommand.Get:
			case TimeParametersCommand.Set:
				return true; // This is mandatory
		}
		return super.supportsCommand(cmd);
	}

	protected [SET_VALUE]: SetValueImplementation = async (
		{ property },
		value,
	): Promise<void> => {
		if (property !== "dateAndTime") {
			throwUnsupportedProperty(this.ccId, property);
		}
		if (!(value instanceof Date)) {
			throwWrongValueType(this.ccId, property, "date", typeof value);
		}
		await this.set(value);

		// Refresh the current value
		await this.get();
	};

	public async get(): Promise<Date> {
		this.assertSupportsCommand(
			TimeParametersCommand,
			TimeParametersCommand.Get,
		);

		const cc = new TimeParametersCCGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
		});
		const response = (await this.driver.sendCommand<TimeParametersCCReport>(
			cc,
		))!;
		return response.dateAndTime;
	}

	public async set(dateAndTime: Date): Promise<void> {
		this.assertSupportsCommand(
			TimeParametersCommand,
			TimeParametersCommand.Set,
		);

		const cc = new TimeParametersCCSet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
			dateAndTime,
		});
		await this.driver.sendCommand(cc);
	}
}

@commandClass(CommandClasses["Time Parameters"])
@implementedVersion(1)
export class TimeParametersCC extends CommandClass {
	declare ccCommand: TimeParametersCommand;

	public async interview(complete: boolean = true): Promise<void> {
		const node = this.getNode()!;
		const endpoint = this.getEndpoint()!;
		const api = endpoint.commandClasses["Time Parameters"];

		log.controller.logNode(node.id, {
			endpoint: this.endpointIndex,
			message: `${this.constructor.name}: doing a ${
				complete ? "complete" : "partial"
			} interview...`,
			direction: "none",
		});

		// Always keep the node's time in sync
		log.controller.logNode(node.id, {
			endpoint: this.endpointIndex,
			message: "setting current time...",
			direction: "outbound",
		});
		await api.set(new Date());

		// Remember that the interview is complete
		this.interviewComplete = true;
	}
}

@CCCommand(TimeParametersCommand.Report)
export class TimeParametersCCReport extends TimeParametersCC {
	public constructor(
		driver: IDriver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);
		validatePayload(this.payload.length >= 7);
		const dateSegments = {
			year: this.payload.readUInt16BE(0),
			month: this.payload[2],
			day: this.payload[3],
			hour: this.payload[4],
			minute: this.payload[5],
			second: this.payload[6],
		};
		this.dateAndTime = segmentsToDate(
			dateSegments,
			shouldUseLocalTime(
				this.getNode()!.getEndpoint(this.endpointIndex)!,
			),
		);
	}

	public readonly dateAndTime: Date;
}

@CCCommand(TimeParametersCommand.Get)
@expectedCCResponse(TimeParametersCCReport)
export class TimeParametersCCGet extends TimeParametersCC {}

interface TimeParametersCCSetOptions extends CCCommandOptions {
	dateAndTime: Date;
}

@CCCommand(TimeParametersCommand.Set)
export class TimeParametersCCSet extends TimeParametersCC {
	public constructor(
		driver: IDriver,
		options:
			| CommandClassDeserializationOptions
			| TimeParametersCCSetOptions,
	) {
		super(driver, options);
		if (gotDeserializationOptions(options)) {
			validatePayload(this.payload.length >= 7);
			const dateSegments = {
				year: this.payload.readUInt16BE(0),
				month: this.payload[2],
				day: this.payload[3],
				hour: this.payload[4],
				minute: this.payload[5],
				second: this.payload[6],
			};
			validatePayload(
				dateSegments.month >= 1 && dateSegments.month <= 12,
				dateSegments.day >= 1 && dateSegments.day <= 31,
				dateSegments.hour >= 0 && dateSegments.hour <= 23,
				dateSegments.minute >= 0 && dateSegments.minute <= 59,
				dateSegments.second >= 0 && dateSegments.second <= 59,
			);
			this.dateAndTime = segmentsToDate(
				dateSegments,
				shouldUseLocalTime(
					this.getNode()!.getEndpoint(this.endpointIndex)!,
				),
			);
		} else {
			// TODO: enforce limits
			this.dateAndTime = options.dateAndTime;
		}
	}

	public dateAndTime: Date;

	public serialize(): Buffer {
		const dateSegments = dateToSegments(
			this.dateAndTime,
			shouldUseLocalTime(
				this.getNode()!.getEndpoint(this.endpointIndex)!,
			),
		);
		this.payload = Buffer.from([
			// 2 bytes placeholder for year
			0,
			0,
			dateSegments.month,
			dateSegments.day,
			dateSegments.hour,
			dateSegments.minute,
			dateSegments.second,
		]);
		this.payload.writeUInt16BE(dateSegments.year, 0);
		return super.serialize();
	}
}
