export function expoEnvironment(inherited:Readonly<Record<string,string|undefined>>,values:Record<string,string>):Record<string,string>;
export function bridgeEnvironment(inherited:Readonly<Record<string,string|undefined>>):Record<string,string>;
export function validateLiveLauncher(input:{apiPort:number;bridgePort:number;expoPort:number;origin:string;loopback?:boolean}):string;
