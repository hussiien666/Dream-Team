declare module 'bidi-js' {
  type Embedding={levels:Uint8Array;paragraphs:{start:number;end:number;level:number}[]};
  export default function factory():{
    getEmbeddingLevels(text:string):Embedding;
    getReorderedIndices(text:string,embedding:Embedding):number[];
    getMirroredCharactersMap(text:string,embedding:Embedding):Map<number,string>;
  };
}
