#include "../../native/include/common.hpp"
#include <httplib.h>
#include <sys/stat.h>
#include "log_parser.hpp"
using namespace pipeline;
std::string source_key(const std::filesystem::path& file) {
#ifdef _WIN32
 HANDLE handle=CreateFileW(file.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
 if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot open source");
 BY_HANDLE_FILE_INFORMATION info{};bool ok=GetFileInformationByHandle(handle,&info);CloseHandle(handle);
 if(!ok)throw std::runtime_error("Cannot identify source");
 return fingerprint(std::filesystem::absolute(file).generic_string()+":"+std::to_string(info.dwVolumeSerialNumber)+":"+std::to_string(info.nFileIndexHigh)+":"+std::to_string(info.nFileIndexLow));
#else
 struct stat info{}; if(::stat(file.c_str(),&info)!=0) throw std::runtime_error("Cannot stat source");
#endif
#ifndef _WIN32
 return fingerprint(std::filesystem::absolute(file).generic_string()+":"+std::to_string(info.st_dev)+":"+std::to_string(info.st_ino));
#endif
}
int main(int argc,char** argv) {
 try {
  signals();
  std::filesystem::path file=option(argc,argv,"--file","data/events.ndjson");
  std::filesystem::path checkpoint=option(argc,argv,"--checkpoint",file.string()+".checkpoint.json");
  auto port=number(option(argc,argv,"--queue-port","8081"),1,65535);
  auto batch_size=number(option(argc,argv,"--batch-size","2048"),1,4096);
  httplib::Client client(option(argc,argv,"--queue-host","127.0.0.1"),port);
  client.set_connection_timeout(1,0); client.set_read_timeout(5,0); client.set_write_timeout(5,0);
  uint64_t offset=0,generation=0; std::string key;
  if(std::filesystem::exists(checkpoint)) {
   std::ifstream in(checkpoint); auto state=json::parse(in); offset=state.at("offset"); key=state.at("source"); generation=state.value("generation",0ULL);
  }
  while(!stopped) {
   if(!std::filesystem::exists(file)) {std::this_thread::sleep_for(std::chrono::milliseconds(50));continue;}
   auto current_key=source_key(file); auto size=std::filesystem::file_size(file);
   if(current_key!=key) {key=current_key;offset=0;generation=0;}
   if(size<offset) {offset=0;++generation;}
   if(size==offset) {std::this_thread::sleep_for(std::chrono::milliseconds(20));continue;}
   std::ifstream in(file,std::ios::binary); in.seekg(static_cast<std::streamoff>(offset));
   std::string buffer(static_cast<size_t>(std::min<uint64_t>(4*1024*1024,size-offset)),'\0'); in.read(buffer.data(),static_cast<std::streamsize>(buffer.size())); buffer.resize(static_cast<size_t>(in.gcount()));
   if(!in && !in.eof()) throw std::runtime_error("Source read failed");
   json logs=json::array(); size_t cursor=0; uint64_t end=offset;
   while(logs.size()<batch_size) {
    auto newline=buffer.find('\n',cursor); if(newline==std::string::npos) break;
    auto line=buffer.substr(cursor,newline-cursor);
    if(line.size()>1024*1024) throw std::runtime_error("Source line exceeds 1 MiB; checkpoint unchanged");
    if(!line.empty() && line.back()=='\r') line.pop_back();
    if(!line.empty()) {
     auto entry=json::parse(line,nullptr,false);
     if(!entry.is_object()) {auto parsed=log_agent::LogParser{}.parse(line);entry={{"message",parsed?parsed->message:line},{"level",parsed?parsed->level:"info"},{"source",file.filename().string()}};if(parsed)entry["timestamp"]=std::chrono::duration_cast<std::chrono::milliseconds>(parsed->timestamp.time_since_epoch()).count();}
     if(!entry.contains("message") || !entry["message"].is_string()) entry["message"]=line;
     if(!entry.contains("source")) entry["source"]=file.filename().string();
     if(!entry.contains("id") || !entry["id"].is_string() || entry["id"].get_ref<const std::string&>().empty()) entry["id"]=fingerprint(key+":"+std::to_string(generation)+":"+std::to_string(offset+cursor)+":"+line);
     if(!entry.contains("raw")) entry["raw"]=line;
     logs.push_back(std::move(entry));
    }
    cursor=newline+1; end=offset+cursor;
   }
   if(end==offset) {
    if(buffer.size()>1024*1024) throw std::runtime_error("Incomplete source line exceeds 1 MiB; checkpoint unchanged");
    std::this_thread::sleep_for(std::chrono::milliseconds(25)); continue;
   }
   if(!logs.empty()) {
    auto payload=json({{"id",fingerprint(key+":"+std::to_string(offset)+":"+std::to_string(end)+":"+logs.dump())},{"logs",std::move(logs)}}).dump();
    bool accepted=false;
    while(!stopped) {
     auto response=client.Post("/api/logs/batch",payload,"application/json");
     if(response && response->status>=200 && response->status<300) {accepted=true;break;}
     if(response && (response->status==400 || response->status==409 || response->status==413)) throw std::runtime_error("Queue rejected source batch; checkpoint unchanged: "+response->body);
     std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    if(!accepted) break;
   }
   atomic_write(checkpoint,json({{"offset",end},{"source",key},{"generation",generation}}).dump()); offset=end;
  }
  return 0;
 } catch(const std::exception& error) {std::cerr<<error.what()<<std::endl;return 1;}
}
