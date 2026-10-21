import updateManager from './common/updateManager';
import {beginMiniappVisit} from './utils/miniapp-visit';
import {installNativePrivacy,showInitialPrivacy} from './utils/privacy-flow';
App({globalData:{productCount:0,lastCatalogSyncAt:null,miniappVisitId:0},onLaunch(){installNativePrivacy();},onShow(options={}){beginMiniappVisit(this);showInitialPrivacy(options);updateManager();}});
