//go:build windows
package main

import (
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "os"
  "os/exec"
  "path/filepath"
  "strings"
  "syscall"
  "time"
  "unsafe"
)
const port="51338"
const appURL="https://yoandarz.github.io/nexit/"
type Settings struct{AppEnabled bool `json:"appEnabled"`; AlarmsEnabled bool `json:"alarmsEnabled"`}
type Schedule struct{TargetDay string `json:"targetDay"`;ShowOnDay string `json:"showOnDay"`;ShowAt string `json:"showAt"`}
type DayState struct{TargetDay string `json:"targetDay"`;SnoozedUntil *string `json:"snoozedUntil"`}
type State struct{Version int `json:"version"`;Settings Settings `json:"settings"`;Schedules []Schedule `json:"schedules"`;DayStates []DayState `json:"dayStates"`}
func main(){
 if len(os.Args)>1 && os.Args[1]=="--fire"{day:="lunes";if len(os.Args)>2{day=os.Args[2]};fire(day);return}
 if len(os.Args)>1 && os.Args[1]=="--test-fire"{fire("lunes");return}
 ensureStartup(); mux:=http.NewServeMux(); mux.HandleFunc("/health",cors(health));mux.HandleFunc("/state",cors(stateHandler));mux.HandleFunc("/test",cors(testHandler));
 srv:=&http.Server{Addr:"127.0.0.1:"+port,Handler:mux,ReadHeaderTimeout:3*time.Second}; _=srv.ListenAndServe()
}
func cors(next http.HandlerFunc)http.HandlerFunc{return func(w http.ResponseWriter,r *http.Request){origin:=r.Header.Get("Origin");if origin=="https://yoandarz.github.io"||strings.HasPrefix(origin,"http://localhost")||strings.HasPrefix(origin,"http://127.0.0.1"){w.Header().Set("Access-Control-Allow-Origin",origin)};w.Header().Set("Vary","Origin");w.Header().Set("Access-Control-Allow-Headers","Content-Type");w.Header().Set("Access-Control-Allow-Methods","GET,POST,OPTIONS");if r.Method=="OPTIONS"{if w.Header().Get("Access-Control-Allow-Origin")==""{http.Error(w,"origin",403);return};w.WriteHeader(204);return};if origin!=""&&w.Header().Get("Access-Control-Allow-Origin")==""{http.Error(w,"origin",403);return};next(w,r)}}
func health(w http.ResponseWriter,r *http.Request){w.Header().Set("Content-Type","application/json");io.WriteString(w,`{"ok":true,"name":"Nexit Alarm Bridge","version":"1.0.0"}`)}
func stateHandler(w http.ResponseWriter,r *http.Request){if r.Method!="POST"{http.Error(w,"method",405);return};var s State;if err:=json.NewDecoder(io.LimitReader(r.Body,1<<20)).Decode(&s);err!=nil{http.Error(w,err.Error(),400);return};saveState(s);if err:=scheduleAll(s);err!=nil{http.Error(w,err.Error(),500);return};w.Header().Set("Content-Type","application/json");io.WriteString(w,`{"ok":true}`)}
func testHandler(w http.ResponseWriter,r *http.Request){if r.Method!="POST"{http.Error(w,"method",405);return};when:=time.Now().Add(time.Minute);if err:=createOnce("NexitAlarm_Test",when,"lunes");err!=nil{http.Error(w,err.Error(),500);return};io.WriteString(w,`{"ok":true}`)}
func scheduleAll(s State)error{for _,d:=range []string{"lunes","martes","miercoles","jueves","viernes","sabado","domingo"}{deleteTask("NexitAlarm_"+d)};for i:=0;i<7;i++{deleteTask(fmt.Sprintf("NexitSnooze_%d",i))};if !s.Settings.AppEnabled||!s.Settings.AlarmsEnabled{return nil};for _,sc:=range s.Schedules{if sc.ShowAt==""{continue};day:=validDay(sc.ShowOnDay);if day==""{day=validDay(sc.TargetDay)};target:=validDay(sc.TargetDay);if day==""||target==""{continue};if err:=createWeekly("NexitAlarm_"+target,day,sc.ShowAt,target);err!=nil{return err}};for i,st:=range s.DayStates{if st.SnoozedUntil==nil||*st.SnoozedUntil==""{continue};t,err:=time.Parse(time.RFC3339,*st.SnoozedUntil);if err==nil&&t.After(time.Now()){target:=validDay(st.TargetDay);if target!=""{if err:=createOnce(fmt.Sprintf("NexitSnooze_%d",i),t.Local(),target);err!=nil{return err}}}};return nil}
func createWeekly(name,day,hhmm,target string)error{exe,_:=os.Executable();tr:=fmt.Sprintf("\"%s\" --fire %s",exe,target);args:=[]string{"/Create","/TN",name,"/TR",tr,"/SC","WEEKLY","/D",winDay(day),"/ST",hhmm,"/F"};return run("schtasks.exe",args...)}
func createOnce(name string,when time.Time,target string)error{exe,_:=os.Executable();tr:=fmt.Sprintf("\"%s\" --fire %s",exe,target);args:=[]string{"/Create","/TN",name,"/TR",tr,"/SC","ONCE","/SD",when.Format("01/02/2006"),"/ST",when.Format("15:04"),"/F"};return run("schtasks.exe",args...)}
func deleteTask(name string){_ = exec.Command("schtasks.exe","/Delete","/TN",name,"/F").Run()}
func ensureStartup(){exe,_:=os.Executable();tr:=fmt.Sprintf("\"%s\"",exe);_ = run("schtasks.exe","/Create","/TN","NexitAlarmBridge_Startup","/TR",tr,"/SC","ONLOGON","/F")}
func run(name string,args ...string)error{c:=exec.Command(name,args...);out,err:=c.CombinedOutput();if err!=nil{return fmt.Errorf("%s: %v: %s",name,err,strings.TrimSpace(string(out)))};return nil}
func validDay(d string)string{switch d{case"lunes","martes","miercoles","jueves","viernes","sabado","domingo":return d};return""}
func winDay(d string)string{m:=map[string]string{"lunes":"MON","martes":"TUE","miercoles":"WED","jueves":"THU","viernes":"FRI","sabado":"SAT","domingo":"SUN"};if x:=m[d];x!=""{return x};return"MON"}
func saveState(s State){dir,_:=os.UserConfigDir();dir=filepath.Join(dir,"NexitAlarmBridge");_ = os.MkdirAll(dir,0700);b,_:=json.MarshalIndent(s,"","  ");_ = os.WriteFile(filepath.Join(dir,"state.json"),b,0600)}
func fire(day string){title:="Nexit";body:="Es hora de revisar la preparación de "+label(day)+".\n\nPulsa Aceptar para abrir Nexit.";messageBox(title,body);_ = exec.Command("rundll32.exe","url.dll,FileProtocolHandler",appURL+"?reminder="+day).Start()}
func label(d string)string{switch d{case"miercoles":return"miércoles";case"sabado":return"sábado"};return d}
func messageBox(title,text string){u:=syscall.NewLazyDLL("user32.dll");p:=u.NewProc("MessageBoxW");t,_:=syscall.UTF16PtrFromString(text);h,_:=syscall.UTF16PtrFromString(title);p.Call(0,uintptr(unsafe.Pointer(t)),uintptr(unsafe.Pointer(h)),0x00001000)}
