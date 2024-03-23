import { IDriver } from "../driver/IDriver";
import log from "../log";
import { ValueID } from "../node/ValueDB";
import { JSONObject, validatePayload } from "../util/misc";
import { enumValuesToMetadataStates, ValueMetadata } from "../values/Metadata";
import { Maybe, parseFloatWithScale } from "../values/Primitive";
import { CCAPI } from "./API";
import {
	API,
	CCCommand,
	ccValue,
	ccValueMetadata,
	CommandClass,
	commandClass,
	CommandClassDeserializationOptions,
	expectedCCResponse,
	implementedVersion,
} from "./CommandClass";
import { CommandClasses } from "./CommandClasses";

// @noSetValueAPI This CC is read-only

export enum BatteryChargingStatus {
	Discharging = 0x00,
	Charging = 0x01,
	Maintaining = 0x02,
}

export enum BatteryReplacementStatus {
	No = 0x00,
	Soon = 0x01,
	Now = 0x02,
}

export enum BatteryCommand {
	Get = 0x02,
	Report = 0x03,
	HealthGet = 0x04,
	HealthReport = 0x05,
}

@API(CommandClasses.Battery)
export class BatteryCCAPI extends CCAPI {
	public supportsCommand(cmd: BatteryCommand): Maybe<boolean> {
		switch (cmd) {
			case BatteryCommand.Get:
				return true; // This is mandatory
			case BatteryCommand.HealthGet:
				return this.version >= 2;
		}
		return super.supportsCommand(cmd);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
	public async get() {
		this.assertSupportsCommand(BatteryCommand, BatteryCommand.Get);

		const cc = new BatteryCCGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
		});
		const response = (await this.driver.sendCommand<BatteryCCReport>(cc))!;
		return {
			level: response.level,
			isLow: response.isLow,
			chargingStatus: response.chargingStatus,
			rechargeable: response.rechargeable,
			backup: response.backup,
			overheating: response.overheating,
			lowFluid: response.lowFluid,
			rechargeOrReplace: response.rechargeOrReplace,
			disconnected: response.disconnected,
		};
	}

	// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
	public async getHealth() {
		this.assertSupportsCommand(BatteryCommand, BatteryCommand.HealthGet);

		const cc = new BatteryCCHealthGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
		});
		const response = (await this.driver.sendCommand<BatteryCCHealthReport>(
			cc,
		))!;
		return {
			maximumCapacity: response.maximumCapacity,
			temperature: response.temperature,
		};
	}
}

@commandClass(CommandClasses.Battery)
@implementedVersion(2)
export class BatteryCC extends CommandClass {
	declare ccCommand: BatteryCommand;

	public async interview(complete: boolean = true): Promise<void> {
		const node = this.getNode()!;
		const endpoint = this.getEndpoint()!;
		const api = endpoint.commandClasses.Battery;

		log.controller.logNode(node.id, {
			endpoint: this.endpointIndex,
			message: `${this.constructor.name}: doing a ${
				complete ? "complete" : "partial"
			} interview...`,
			direction: "none",
		});

		// always query the status
		log.controller.logNode(node.id, {
			endpoint: this.endpointIndex,
			message: "querying battery status...",
			direction: "outbound",
		});

		const batteryStatus = await api.get();

		let logMessage = `received response for battery information:
level:                           ${batteryStatus.level}${
			batteryStatus.isLow ? " (low)" : ""
		}`;
		if (this.version >= 2) {
			logMessage += `
status:                          ${
				BatteryChargingStatus[batteryStatus.chargingStatus!]
			}
rechargeable:                    ${batteryStatus.rechargeable}
is backup:                       ${batteryStatus.backup}
is overheating:                  ${batteryStatus.overheating}
fluid is low:                    ${batteryStatus.lowFluid}
needs to be replaced or charged: ${
				BatteryReplacementStatus[batteryStatus.rechargeOrReplace!]
			}
is disconnected:                 ${batteryStatus.disconnected}`;
		}
		log.controller.logNode(node.id, {
			endpoint: this.endpointIndex,
			message: logMessage,
			direction: "inbound",
		});

		if (this.version >= 2) {
			// always query the health
			log.controller.logNode(node.id, {
				endpoint: this.endpointIndex,
				message: "querying battery health...",
				direction: "outbound",
			});

			const batteryHealth = await api.getHealth();

			const logMessage = `received response for battery health:
max. capacity: ${batteryHealth.maximumCapacity} %
temperature:   ${batteryHealth.temperature} °C`;
			log.controller.logNode(node.id, {
				endpoint: this.endpointIndex,
				message: logMessage,
				direction: "inbound",
			});
		}

		// Remember that the interview is complete
		this.interviewComplete = true;
	}
}

@CCCommand(BatteryCommand.Report)
export class BatteryCCReport extends BatteryCC {
	public constructor(
		driver: IDriver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);

		validatePayload(this.payload.length >= 1);
		this._level = this.payload[0];
		if (this._level === 0xff) {
			this._level = 0;
			this._isLow = true;
		} else {
			this._isLow = false;
		}

		if (this.payload.length >= 3) {
			// Starting with V2
			this._chargingStatus = this.payload[1] >>> 6;
			this._rechargeable = !!(this.payload[1] & 0b0010_0000);
			this._backup = !!(this.payload[1] & 0b0001_0000);
			this._overheating = !!(this.payload[1] & 0b1000);
			this._lowFluid = !!(this.payload[1] & 0b0100);
			this._rechargeOrReplace = !!(this.payload[1] & 0b10)
				? BatteryReplacementStatus.Now
				: !!(this.payload[1] & 0b1)
				? BatteryReplacementStatus.Soon
				: BatteryReplacementStatus.No;
			this._disconnected = !!(this.payload[2] & 0b1);
		}

		this.persistValues();
	}

	private _level: number;
	@ccValue()
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyUInt8,
		max: 100,
		label: "Battery level",
	})
	public get level(): number {
		return this._level;
	}

	private _isLow: boolean;
	@ccValue()
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyBoolean,
		label: "Level is low",
	})
	public get isLow(): boolean {
		return this._isLow;
	}

	private _chargingStatus: BatteryChargingStatus | undefined;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyUInt8,
		label: "Charging status",
		states: enumValuesToMetadataStates(BatteryChargingStatus),
	})
	public get chargingStatus(): BatteryChargingStatus | undefined {
		return this._chargingStatus;
	}

	private _rechargeable: boolean | undefined;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyBoolean,
		label: "Rechargeable",
	})
	public get rechargeable(): boolean | undefined {
		return this._rechargeable;
	}

	private _backup: boolean | undefined;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyBoolean,
		label: "Used as backup",
	})
	public get backup(): boolean | undefined {
		return this._backup;
	}

	private _overheating: boolean | undefined;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyBoolean,
		label: "Overheating",
	})
	public get overheating(): boolean | undefined {
		return this._overheating;
	}

	private _lowFluid: boolean | undefined;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyBoolean,
		label: "Fluid is low",
	})
	public get lowFluid(): boolean | undefined {
		return this._lowFluid;
	}

	private _rechargeOrReplace: BatteryReplacementStatus | undefined;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyUInt8,
		label: "Recharge or replace",
		states: enumValuesToMetadataStates(BatteryReplacementStatus),
	})
	public get rechargeOrReplace(): BatteryReplacementStatus | undefined {
		return this._rechargeOrReplace;
	}

	private _disconnected: boolean | undefined;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyBoolean,
		label: "Battery is disconnected",
	})
	public get disconnected(): boolean | undefined {
		return this._disconnected;
	}

	public toJSON(): JSONObject {
		return super.toJSONInherited({
			level: this.level,
			isLow: this.isLow,
			chargingStatus: this.chargingStatus,
			rechargeable: this.rechargeable,
			backup: this.backup,
			overheating: this.overheating,
			lowFluid: this.lowFluid,
			rechargeOrReplace: this.rechargeOrReplace,
			disconnected: this.disconnected,
		});
	}
}

@CCCommand(BatteryCommand.Get)
@expectedCCResponse(BatteryCCReport)
export class BatteryCCGet extends BatteryCC {}

@CCCommand(BatteryCommand.HealthReport)
export class BatteryCCHealthReport extends BatteryCC {
	public constructor(
		driver: IDriver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);

		validatePayload(this.payload.length >= 2);
		this._maximumCapacity = this.payload[0];
		const { value: temperature, scale } = parseFloatWithScale(
			this.payload.slice(1),
		);
		this._temperature = temperature;

		const valueId: ValueID = {
			commandClass: this.ccId,
			endpoint: this.endpointIndex,
			property: "temperature",
		};
		this.getValueDB().setMetadata(valueId, {
			...ValueMetadata.ReadOnlyNumber,
			label: "Temperature",
			unit: scale === 0x00 ? "°C" : undefined,
		});
	}

	private _maximumCapacity: number;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyUInt8,
		max: 100,
		unit: "%",
		label: "Maximum capacity",
	})
	public get maximumCapacity(): number {
		return this._maximumCapacity;
	}

	private _temperature: number;
	@ccValue({ minVersion: 2 })
	@ccValueMetadata({
		...ValueMetadata.ReadOnlyUInt8,
		label: "Temperature",
	})
	public get temperature(): number {
		return this._temperature;
	}
}

@CCCommand(BatteryCommand.HealthGet)
@expectedCCResponse(BatteryCCHealthReport)
export class BatteryCCHealthGet extends BatteryCC {}
