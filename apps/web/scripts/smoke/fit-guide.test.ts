import assert from "node:assert/strict";
import test from "node:test";
import {parseFitFields,recommendX1Fit,fitMessage} from "../../lib/fit-guide";
const values=(waistCm:number|null,preference:"regular"|"relaxed"="regular",weightKg:number|null=null)=>({heightCm:null,waistCm,weightKg,preference});
test("published waist boundaries and preference select a row without inventing larger sizes",()=>{
  assert.equal(recommendX1Fit(values(72)).recommended,"S");
  assert.equal(recommendX1Fit(values(72,"relaxed")).recommended,"M");
  assert.equal(recommendX1Fit(values(80)).recommended,"M");
  assert.equal(recommendX1Fit(values(80,"relaxed")).recommended,"L");
  assert.equal(recommendX1Fit(values(88)).recommended,"L");
  for(const waist of [63.9,88.1,120])assert.equal(recommendX1Fit(values(waist)).recommended,null);
  assert.equal(recommendX1Fit(values(71.9,"relaxed")).recommended,"S");
});
test("weight and height cannot override measured waist or produce false certainty",()=>{
  const reference=recommendX1Fit(values(null,"regular",58));
  assert.equal(reference.recommended,null);assert.deepEqual(reference.candidates,["S","M"]);
  const mismatch=recommendX1Fit({...values(76,"regular",100),heightCm:190});
  assert.equal(mismatch.recommended,"M");assert.equal(mismatch.weightMismatch,true);
  assert.ok(fitMessage(mismatch).includes("差异"));
});
test("optional measurements support one decimal and reject coercion or invalid values",()=>{
  assert.deepEqual(parseFitFields({waistCm:"76.5",heightCm:"",weightKg:null}),{waistCm:76.5,heightCm:null,weightKg:null,preference:"regular"});
  for(const bad of [false,[],{},"1e2","76.55",NaN,Infinity,-1,201])assert.throws(()=>parseFitFields({waistCm:bad}));
});
