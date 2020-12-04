package com.taskr.core.Storages;

import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;


import java.util.List;
import java.util.Set;


@Service
public class TaskTemplateStorage {

    private TaskTemplateRepository taskTemplateRepo;
    private UserRepository userRepo;
    private UserStorage userStorage;


    public TaskTemplateStorage(TaskTemplateRepository taskTemplateRepo, UserRepository userRepo) {
        this.taskTemplateRepo = taskTemplateRepo;
        this.userRepo = userRepo;
        UserStorage userStorage = new UserStorage(userRepo);
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
        if (taskTemplateRepo.findById(id).isPresent()) {
            return taskTemplateRepo.findById(id).get();
        } else return null;
    }

    public void addAllUsersToAllTaskTemplates(){
        for (TaskTemplate taskTemplate : taskTemplateRepo.findAll()){
            for (User user : userStorage.findAll()){
                taskTemplate.addUserWhoCanDoThisTask(user);
            }
        }
    }

    public void allocateAllTasks(){
        allocateTasks(taskTemplateRepo.findAll());
    }

    public void allocateTasks(Iterable<TaskTemplate> taskTemplateList) {
        userStorage.updateAllUsers();
        for (TaskTemplate taskTemplate : taskTemplateList){
            Iterable<User> candidateUsers = taskTemplate.getUsersWhoCanDoThisTask();
            User assignedUser = candidateUsers.iterator().next();
            for(User user : candidateUsers) {
                if(user.getRemainingAvailableTime()>assignedUser.getRemainingAvailableTime()){
                    assignedUser = user;
                }else if (user.getRemainingAvailableTime() == assignedUser.getRemainingAvailableTime()){
                    if (Math.random()*2>=1){
                        assignedUser = user;
                    }

                }
                assignedUser.updateUser();
                userStorage.save(assignedUser);
            }
        }
    }
}
