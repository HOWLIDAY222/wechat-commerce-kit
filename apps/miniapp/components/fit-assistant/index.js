import { withTapFeedback } from '../../utils/tap-feedback';
import {FIT_CONSENT_VERSION,X1_FIT_ROWS,fitMessage,parseFitFields,recommendX1Fit} from '../../utils/fit-guide';
import {request} from '../../services/http';
import {hasSession,readAccessToken} from '../../stores/session';
import {rememberFitLoginReturn} from '../../stores/navigation';

const empty=()=>({heightCm:'',weightKg:'',waistCm:'',preference:'regular'});
Component(withTapFeedback({
  properties:{selectable:{type:Boolean,value:false},sizes:{type:Array,value:[],observer:'updateReference'}},
  data:{fields:empty(),rows:[],recommended:'',referenceMessage:'填写腰围，实时查看参考尺码。',invalid:false,loggedIn:false,ready:false,busy:false,consented:false,profile:null,message:'',showPrivacy:false,canApply:false},
  lifetimes:{attached(){this.alive=true;this.loadId=0;this.dirty=false;this.updateReference();this.refresh();},detached(){this.alive=false;this.loadId++;}},
  pageLifetimes:{show(){if(this.lastToken!==readAccessToken()){this.applyProfile(null);this.refresh();}}},
  methods:{
    async refresh(force=false){
      const token=readAccessToken();this.lastToken=token;
      if(!hasSession()){this.accountId='';this.setData({loggedIn:false,ready:true,profile:null});return;}
      const loadId=++this.loadId;this.setData({loggedIn:true,ready:false,message:''});
      try {
        const response=await request({path:'/api/account/fit-profile',auth:'required'});
        if(!this.alive||loadId!==this.loadId)return;
        if(!response?.ok||!response.accountId)throw Error('FIT_PROFILE_UNAVAILABLE');
        this.accountId=response.accountId;this.setData({profile:response.profile||null,ready:true});
        if(force===true||!this.dirty)this.applyProfile(response.profile||null);
      }catch(error){if(this.alive&&loadId===this.loadId){if(['AUTH_REQUIRED','SESSION_CHANGED'].includes(error.message)){this.accountId='';this.applyProfile(null);this.setData({loggedIn:false});}this.setData({message:'档案暂未同步，请重新加载后保存；仍可使用尺码参考。'});}}
    },
    reload(){if(!this.data.busy)this.refresh(true);},
    applyProfile(profile){this.dirty=false;this.setData({profile,fields:profile?{heightCm:profile.heightCm===null?'':String(profile.heightCm),weightKg:profile.weightKg===null?'':String(profile.weightKg),waistCm:profile.waistCm===null?'':String(profile.waistCm),preference:profile.preference}:empty(),consented:false});this.updateReference();},
    input(event){const key=event.currentTarget.dataset.key;if(!['heightCm','weightKg','waistCm'].includes(key)||this.data.busy)return;this.dirty=true;this.setData({fields:{...this.data.fields,[key]:event.detail.value},message:''});this.updateReference();},
    choosePreference(event){const preference=event.currentTarget.dataset.preference;if(!['regular','relaxed'].includes(preference)||this.data.busy)return;this.dirty=true;this.setData({fields:{...this.data.fields,preference}});this.updateReference();},
    updateReference(){
      let result,invalid=false;try{result=recommendX1Fit(parseFitFields(this.data.fields));}catch{invalid=true;result={recommended:null,candidates:[]};}
      const sizes=this.properties.sizes||[],canApply=!!result.recommended&&sizes.some(row=>row.size===result.recommended&&!row.disabled);
      this.setData({invalid,recommended:result.recommended||'',referenceMessage:invalid?'请检查数值，最多保留一位小数。':fitMessage(result),canApply,rows:X1_FIT_ROWS.map(row=>({...row,selected:result.recommended===row.size,reference:result.candidates.includes(row.size)}))});
    },
    consent(event){this.setData({consented:event.detail.value.includes('fit')});},
    togglePrivacy(){this.setData({showPrivacy:!this.data.showPrivacy});},
    async save(){
      if(this.data.busy||!this.data.ready||!this.accountId||!this.data.consented||this.data.invalid)return;
      let values;try{values=parseFitFields(this.data.fields);}catch{return;}
      if(values.heightCm===null&&values.weightKg===null&&values.waistCm===null){this.setData({message:'请至少填写一项身体数据，清空档案请使用删除。'});return;}
      await this.mutate('PUT',{...values,consentVersion:FIT_CONSENT_VERSION});
    },
    async remove(){
      if(this.data.busy||!this.data.ready||!this.data.profile)return;
      const result=await new Promise(resolve=>wx.showModal({title:'删除尺码档案',content:'确认删除账户中保存的身体数据？',confirmText:'确认删除',success:resolve,fail:()=>resolve({confirm:false})}));
      if(result.confirm&&this.alive&&!this.data.busy)await this.mutate('DELETE',{});
    },
    async mutate(method,values){
      this.setData({busy:true,message:''});
      try {
        const response=await request({path:'/api/account/fit-profile',method,auth:'required',data:{accountId:this.accountId,revision:this.data.profile?.revision||0,...values}});
        if(!this.alive)return;
        if(!response?.ok)throw Error('FIT_PROFILE_UNAVAILABLE');
        this.applyProfile(response.profile||null);this.setData({message:method==='DELETE'?'尺码档案已从账户删除。':'已保存，官网与小程序登录同一品牌账户后可共用。'});
      }catch(error){if(this.alive){if(['AUTH_REQUIRED','SESSION_CHANGED'].includes(error.message)){this.accountId='';this.applyProfile(null);this.setData({loggedIn:false,ready:false});}if(error.message==='FIT_PROFILE_CONFLICT')this.setData({ready:false});this.setData({message:error.message==='FIT_PROFILE_CONFLICT'?'档案已在其他页面或设备更新，请重新加载后修改。':'操作未完成，请重新加载核对最新档案。'});}}
      finally{if(this.alive)this.setData({busy:false});}
    },
    useSize(){if(this.properties.selectable&&this.data.canApply&&!this.data.invalid)this.triggerEvent('select',{size:this.data.recommended});},
    signIn(){rememberFitLoginReturn();wx.switchTab({url:'/pages/account/index'});},
  },
}, ["choosePreference","useSize","togglePrivacy","save","remove","signIn","reload"], {"component":true}));
