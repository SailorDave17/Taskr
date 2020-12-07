package com.taskr.core.Storages;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.Set;


@Service
public class TaskTemplateStorage {

    private TaskTemplateRepository taskTemplateRepo;
    private UserRepository userRepo;
    private TaskRepository taskRepo;


    public TaskTemplateStorage(TaskTemplateRepository taskTemplateRepo, UserRepository userRepo, TaskRepository taskRepo) {
        this.taskTemplateRepo = taskTemplateRepo;
        this.userRepo = userRepo;
        this.taskRepo = taskRepo;
    }

    public void save(TaskTemplate taskTemplate) {
        taskTemplateRepo.save(taskTemplate);
    }

    public void deleteById(Long id) {
        taskTemplateRepo.deleteById(id);
    }

    public Iterable<TaskTemplate> findAll() {
        return taskTemplateRepo.findAll();
    }

    public TaskTemplate findById(Long id) {
        TaskTemplate dummyTaskTemplate = new TaskTemplate("TaskTemplate not found", 300, 300);
        if (taskTemplateRepo.findById(id).isPresent()) {
            return taskTemplateRepo.findById(id).get();
        } else return dummyTaskTemplate ;
    }

    public void allocateSingleTask(TaskTemplate taskTemplate){
        Set<User> candidateUsers = new HashSet<>();
        UserStorage userStorage = new UserStorage(userRepo, taskTemplateRepo);
        TaskStorage taskStorage = new TaskStorage(taskRepo, taskTemplateRepo, userRepo);
        Iterable<User> allUsers = userStorage.findAll();
        System.out.println(allUsers);
        for (User user : allUsers){
            if (!taskTemplate.getUsersWhoCannotDoThisTask().contains(user)){
                candidateUsers.add(user);
            }
        }
        User assignedUser = candidateUsers.iterator().next();
        for(User user : candidateUsers) {
            if(user.getRemainingAvailableTime()>assignedUser.getRemainingAvailableTime()){
                assignedUser = user;
            }else if (user.getRemainingAvailableTime() == assignedUser.getRemainingAvailableTime()){
                if (Math.random()*2>=1){
                    assignedUser = user;
                }

            }
        }
        Task newTask = new Task(assignedUser, taskTemplate);
        taskStorage.save(newTask);
        userStorage.updateUser(assignedUser);
        userStorage.save(assignedUser);
    }

    public void allocateAllTasks(){
        for (TaskTemplate taskTemplate : taskTemplateRepo.findAll()){
            allocateSingleTask(taskTemplate);
        }
    }

    public void allocateTasks(Set<TaskTemplate> taskTemplateList) {
        for (TaskTemplate taskTemplate : taskTemplateList){
            allocateSingleTask(taskTemplate);
        }
    }
}
