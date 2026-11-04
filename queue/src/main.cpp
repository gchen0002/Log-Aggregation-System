#include "../../native/include/common.hpp"
#include "../include/sqlite_queue.hpp"
#include <httplib.h>
using namespace pipeline;
int main(int argc,char** argv) {
 try {
  signals();
  auto port=number(option(argc,argv,"--port","8081"),1,65535);
  auto threads=number(option(argc,argv,"--threads","8"),1,64);
  auto capacity=number(option(argc,argv,"--capacity","500000"),1,100000000);
  auto lease=number(option(argc,argv,"--lease-seconds","30"),1,3600);
  log_queue::SqliteQueue queue(option(argc,argv,"--db","data/queue.db"),capacity,lease);
  httplib::Server server; server.new_task_queue=[threads]{return new httplib::ThreadPool(threads);};
  server.set_payload_max_length(8*1024*1024);
  server.set_read_timeout(10,0); server.set_write_timeout(10,0);
  server.set_exception_handler([](const httplib::Request&,httplib::Response& response,std::exception_ptr error) { try {std::rethrow_exception(error);}catch(const std::exception& e){std::cerr<<e.what()<<std::endl;} response.status=500; response.set_content("{\"error\":\"Queue operation failed\"}","application/json"); });
  server.Get("/health",[](const httplib::Request&,httplib::Response& res){res.set_content("{\"status\":\"ok\"}","application/json");});
  server.Get("/api/queue/stats",[&](const httplib::Request&,httplib::Response& res){res.set_content(queue.stats().dump(),"application/json");});
  server.Post("/api/logs/batch",[&](const httplib::Request& req,httplib::Response& res){
   auto value=json::parse(req.body,nullptr,false);
   if(!value.is_object() || !value.contains("id") || !value["id"].is_string() || value["id"].get_ref<const std::string&>().empty() || value["id"].get_ref<const std::string&>().size()>256 || !value.contains("logs") || !value["logs"].is_array() || value["logs"].empty() || value["logs"].size()>4096) {res.status=400;res.set_content("{\"error\":\"Expected batch id and 1–4096 log objects\"}","application/json");return;}
   for(const auto& entry:value["logs"]) {
    if(!entry.is_object() || !entry.contains("message") || !entry["message"].is_string() || entry["message"].get_ref<const std::string&>().size()>10000 || (entry.contains("source") && (!entry["source"].is_string() || entry["source"].get_ref<const std::string&>().size()>500))) {res.status=400;res.set_content("{\"error\":\"Invalid log object\"}","application/json");return;}
   }
   res.status=queue.enqueue(value["id"],value["logs"]); res.set_content(json({{"accepted",res.status<300},{"duplicate",res.status==200}}).dump(),"application/json");
  });
  server.Get("/api/logs/pending",[&](const httplib::Request&,httplib::Response& res){res.set_content(queue.claim(4),"application/json");});
  server.Post("/api/logs/ack",[&](const httplib::Request& req,httplib::Response& res){
   auto value=json::parse(req.body,nullptr,false);
   if(!value.is_object() || !value.contains("leases") || !value["leases"].is_array() || value["leases"].size()>64) {res.status=400;res.set_content("{}","application/json");return;}
   for(const auto& item:value["leases"]) if(!item.is_object() || !item.contains("id") || !item["id"].is_string() || !item.contains("lease") || !item["lease"].is_string()) {res.status=400;res.set_content("{}","application/json");return;}
   res.set_content(json({{"acknowledged",queue.acknowledge(value["leases"])}}).dump(),"application/json");
  });
  auto host=option(argc,argv,"--host","127.0.0.1");
  if(!server.bind_to_port(host,port)) throw std::runtime_error("Queue port is busy");
  std::thread watcher([&]{while(!stopped) std::this_thread::sleep_for(std::chrono::milliseconds(50));server.stop();});
  std::cout<<"Durable queue listening on "<<host<<":"<<port<<std::endl;
  server.listen_after_bind(); stopped=1; watcher.join(); return 0;
 } catch(const std::exception& error) {std::cerr<<error.what()<<std::endl;return 1;}
}
