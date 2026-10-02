import {createContext,useContext} from 'react';
import {draftStorage} from './draft-storage';
export const DraftStorageContext=createContext<ReturnType<typeof draftStorage.lease>>(draftStorage);
export const useDraftStorage=()=>useContext(DraftStorageContext);
