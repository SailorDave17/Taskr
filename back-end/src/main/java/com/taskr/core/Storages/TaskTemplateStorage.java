package com.taskr.core.Storages;

import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.Set;


@Service
public class TaskTemplateStorage {

    private TaskTemplateRepository taskTemplateRepo;
    private UserRepository userRepo;


    public TaskTemplateStorage(TaskTemplateRepository taskTemplateRepo, UserRepository userRepo) {
        this.taskTemplateRepo = taskTemplateRepo;
        this.userRepo = userRepo;
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
        TaskTemplate dummyTaskTemplate = new TaskTemplate("TaskTemplate not found");
        if (taskTemplateRepo.findById(id).isPresent()) {
            return taskTemplateRepo.findById(id).get();
        } else return dummyTaskTemplate ;
    }

    public void allocateAllTasks(){
        allocateTasks((Set<TaskTemplate>) taskTemplateRepo.findAll());
    }

    public void allocateTasks(Set<TaskTemplate> taskTemplateList) {
        UserStorage userStorage = new UserStorage(userRepo, taskTemplateRepo);
        userStorage.updateAllUsers();
        for (TaskTemplate taskTemplate : taskTemplateList){
            Set<User> candidateUsers = new HashSet<>();
            for (User user : userStorage.findAll()){
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
                assignedUser.updateUser();
                userStorage.save(assignedUser);
            }
        }
    }
}
